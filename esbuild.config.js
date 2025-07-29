import { build } from 'esbuild';

// ESBuild configuration that excludes problematic dependencies
const buildConfig = {
  entryPoints: ['server/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outdir: 'dist',
  external: [
    // Mark problematic dependencies as external
    'lightningcss',
    '@babel/preset-typescript',
    'bufferutil',
    'utf-8-validate',
    'pg-native',
    'fluent-ffmpeg',
    // Node.js built-ins
    'fs',
    'path',
    'crypto',
    'url',
    'stream',
    'util',
    'events',
    'buffer',
    'child_process',
    'os',
    'http',
    'https',
    'net',
    'tls',
    'zlib',
    'querystring'
  ],
  loader: {
    '.ts': 'ts',
    '.js': 'js'
  },
  tsconfig: 'tsconfig.json',
  target: 'node20',
  keepNames: true,
  sourcemap: false,
  minify: false
};

try {
  await build(buildConfig);
  console.log('Server build completed successfully!');
} catch (error) {
  console.error('Build failed:', error);
  process.exit(1);
}