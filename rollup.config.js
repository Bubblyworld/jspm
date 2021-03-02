export default {
  input: [
    'lib/tracemap/tracemap.js',
    'lib/install/resolver.js',
    'lib/install/package.js'
  ],

  plugins: [{
    resolveId (id) {
      if (id === '@iarna/toml')
        return './empty.js';
    }
  }],

  output: {
    dir: 'dist/api',
    format: 'esm'
  },

  // disable external module warnings
  // (JSPM / the import map handles these for us instead)
  onwarn (warning, warn) {
    if (warning.code === 'UNRESOLVED_IMPORT')
      return;
    warn(warning);
  }
};
