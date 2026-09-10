import {
  MongoClient,
  MongoServerError,
  type Collection,
  type Document as MongoDocument,
} from 'mongodb';

import type { LevelManifest } from './level-manifest.ts';
import { assertLevelManifestSchema } from './level-schema.ts';

const DEFAULT_MONGODB_URI = 'mongodb://127.0.0.1:27017';
const DEFAULT_DATABASE_NAME = 'hextile';
const DEFAULT_COLLECTION_NAME = 'levels';
const CONNECTION_TIMEOUT_MS = 3_000;

const levelCollectionValidator: MongoDocument = {
  $jsonSchema: {
    bsonType: 'object',
    additionalProperties: false,
    required: [
      '_id',
      'id',
      'name',
      'deployed',
      'stage',
      'levelNumber',
      'originalSolution',
    ],
    properties: {
      _id: {},
      id: { bsonType: 'string' },
      name: { bsonType: 'string', minLength: 1, maxLength: 80 },
      deployed: { bsonType: 'bool' },
      stage: { bsonType: ['int', 'long', 'double'], minimum: 1 },
      levelNumber: {
        bsonType: ['int', 'long', 'double', 'null'],
        minimum: 1,
      },
      originalSolution: { bsonType: 'object' },
      initialDistribution: { bsonType: 'object' },
      initialHand: { bsonType: 'object' },
    },
  },
};

let mongoClient: MongoClient | null = null;
let mongoClientPromise: Promise<MongoClient> | null = null;
let levelCollectionPromise: Promise<Collection<LevelManifest>> | null = null;

function getMongoConfiguration() {
  const uri = process.env.MONGODB_URI?.trim() || DEFAULT_MONGODB_URI;
  const databaseName =
    process.env.MONGODB_DATABASE?.trim() || DEFAULT_DATABASE_NAME;
  const collectionName =
    process.env.MONGODB_LEVELS_COLLECTION?.trim() || DEFAULT_COLLECTION_NAME;

  if (!databaseName || /[/\\."$*<>:|?]/.test(databaseName)) {
    throw new Error('MONGODB_DATABASE contiene un nombre no válido.');
  }
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(collectionName)) {
    throw new Error('MONGODB_LEVELS_COLLECTION contiene un nombre no válido.');
  }

  return { uri, databaseName, collectionName };
}

async function getMongoClient() {
  if (!mongoClientPromise) {
    const { uri } = getMongoConfiguration();
    mongoClient = new MongoClient(uri, {
      serverSelectionTimeoutMS: CONNECTION_TIMEOUT_MS,
    });
    mongoClientPromise = mongoClient.connect().catch(async (error) => {
      const failedClient = mongoClient;
      mongoClient = null;
      mongoClientPromise = null;
      levelCollectionPromise = null;
      await failedClient?.close().catch(() => undefined);
      throw error;
    });
  }

  return mongoClientPromise;
}

async function initializeLevelCollection() {
  const client = await getMongoClient();
  const { databaseName, collectionName } = getMongoConfiguration();
  const database = client.db(databaseName);
  const collectionExists = await database
    .listCollections({ name: collectionName }, { nameOnly: true })
    .hasNext();

  if (!collectionExists) {
    try {
      await database.createCollection(collectionName, {
        validator: levelCollectionValidator,
        validationAction: 'error',
        validationLevel: 'strict',
      });
    } catch (error) {
      if (!(error instanceof MongoServerError) || error.code !== 48) {
        throw error;
      }
    }
  }

  const collection = database.collection<LevelManifest>(collectionName);
  await Promise.all([
    collection.createIndex(
      { id: 1 },
      { unique: true, name: 'unique_level_id' },
    ),
    collection.createIndex(
      { name: 1 },
      {
        unique: true,
        name: 'unique_level_name',
        collation: { locale: 'es', strength: 2 },
      },
    ),
    collection.createIndex(
      { stage: 1, deployed: 1, levelNumber: 1 },
      { name: 'levels_by_stage_and_position' },
    ),
  ]);

  return collection;
}

export function getLevelCollection() {
  if (!levelCollectionPromise) {
    levelCollectionPromise = initializeLevelCollection().catch((error) => {
      levelCollectionPromise = null;
      throw error;
    });
  }
  return levelCollectionPromise;
}

function toLevelManifest(
  document: LevelManifest & { _id?: unknown },
  { requireComplete = false }: { requireComplete?: boolean } = {},
) {
  const { _id: _mongoId, ...manifest } = document;
  assertLevelManifestSchema(manifest, { requireComplete });
  return manifest;
}

export async function listLevelStageNumbers() {
  const collection = await getLevelCollection();
  const stages = await collection.distinct('stage', {
    initialDistribution: { $exists: true },
    initialHand: { $exists: true },
  });
  return stages
    .filter((stage): stage is number => Number.isInteger(stage) && stage > 0)
    .sort((left, right) => left - right);
}

export async function readLevelDocuments(stage?: number) {
  const collection = await getLevelCollection();
  const filter = {
    ...(stage === undefined ? {} : { stage }),
    initialDistribution: { $exists: true },
    initialHand: { $exists: true },
  };
  const documents = await collection
    .find(filter)
    .sort({ stage: 1, levelNumber: 1, name: 1 })
    .toArray();

  return documents.map((document) =>
    toLevelManifest(document, { requireComplete: true }),
  );
}

export async function readLevelDocumentById(id: string) {
  const collection = await getLevelCollection();
  const document = await collection.findOne({ id });
  return document ? toLevelManifest(document) : null;
}

export async function insertLevelDocument(manifest: LevelManifest) {
  assertLevelManifestSchema(manifest);
  const collection = await getLevelCollection();
  await collection.insertOne(manifest);
}

export async function replaceLevelDocuments(manifests: LevelManifest[]) {
  manifests.forEach((manifest) => assertLevelManifestSchema(manifest));
  if (manifests.length === 0) return;

  const collection = await getLevelCollection();
  const result = await collection.bulkWrite(
    manifests.map((manifest) => ({
      replaceOne: {
        filter: { id: manifest.id },
        replacement: manifest,
      },
    })),
    { ordered: true },
  );

  if (result.matchedCount !== manifests.length) {
    throw new Error(
      'Uno o más niveles dejaron de existir durante la operación.',
    );
  }
}

export async function seedLevelDocuments(manifests: LevelManifest[]) {
  manifests.forEach((manifest) =>
    assertLevelManifestSchema(manifest, { requireComplete: true }),
  );
  const collection = await getLevelCollection();
  const existingCount = await collection.countDocuments();
  if (existingCount > 0) {
    throw new Error(
      'La colección de niveles ya contiene documentos; no se modificó.',
    );
  }
  if (manifests.length > 0) {
    await collection.insertMany(manifests, { ordered: true });
  }
  return manifests.length;
}

export function isDuplicateLevelKeyError(error: unknown) {
  return error instanceof MongoServerError && error.code === 11000;
}

export async function closeMongoLevelStore() {
  const client = mongoClient;
  mongoClient = null;
  mongoClientPromise = null;
  levelCollectionPromise = null;
  await client?.close();
}
