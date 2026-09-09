import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'HEXTILE',
  description: 'Rompecabezas de lógica sobre una tesela hexagonal.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
