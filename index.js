var fs = require('fs');
var crypto = require('crypto');
var browserify = require('browserify');
var watchify = require('watchify-with-cache');
var uglify = require('uglify-js');
var convertSourceMap = require('convert-source-map');
var anymatch = require('anymatch');
var path = require('path');
var os = require('os');
var util;
var tmpdir = os.tmpdir()

module.exports = function(racer) {
  var Backend = racer.Backend || racer.Store;
  Backend.prototype.bundle = bundle;
  util = racer.util;
};

function bundle(entryFile, options, cb) {
  if (typeof options === 'function') {
    cb = options;
    options = null;
  }
  options || (options = {});
  options.debug = true;
  options.packageCache = {};
  // The file paths in ignore should be ignored when monitoring for changes.
  options.ignore = (options.ignore == null) ? [] : options.ignore
  options.ignore.forEach(function(filepath) {
    // NOTE: Chokidar provides the realpath's of files as their ids, so we
    // have to add any realpath values that don't match the provided filepath's
    // to our ignore array
    var realpath = fs.realpathSync(filepath);
    if (realpath !== filepath) options.ignore.push(realpath);
  });

  var minify = (options.minify == null) ? util.isProduction : options.minify;
  options.fullPaths = (options.fullPaths == null) ? !util.isProduction : options.fullPaths;

  // If useCache is defined, we use a persistent cache
  var entryFileHash = hashFilename(entryFile);
  var bundleCachePath, moduleCachePath;
  // Allow env var flags to override options
  var useCache = (process.env.CLEAR_CACHE == null) ? options.useCache : process.env.CLEAR_CACHE;
  var clearCache = (process.env.USE_CACHE == null) ? options.useCache : process.env.USE_CACHE;
  if (useCache) {
    bundleCachePath = path.resolve(tmpdir,  entryFileHash + '.bundle.cache.js');
    moduleCachePath = path.resolve(tmpdir, entryFileHash + '.modules.cache.json');
    if (clearCache) {
      console.log('[racer-bundle] Watchify cache cleared.')
      fs.writeFileSync(moduleCachePath, '{}');
    }
    console.log('[racer-bundle] Loading watchify cache')
    options.cache = watchify.getCache(moduleCachePath);
  } else {
    options.cache = {}
  }

  var b = browserify(options);

  // Echo log messages
  b.on('log', function (msg) {
    console.log(entryFile, 'log:', msg);
  });

  // Add the entryFile
  b.add(entryFile);
  this.emit('bundle', b);

  // Wrap browserify with caching + watching logic if requested
  if (options.onRebundle || options.useCache) {
    b = watchify(b, {
      delay: 100,
      cacheFile: moduleCachePath,
      // The ignored paths should be checked by sha instead of mtime when deciding
      // if they are invalid. This prevents regenerating the same view partials
      // from causing a rebundle
      checkShasum: options.ignore.slice(),
      watch: !!options.onRebundle
    });
    var matchIgnorePaths = anymatch(options.ignore)
    // Rebundle whenever a file is changed unless explicitly ignored
    b.on('update', function(ids) {
      console.log('[racer-bundle] Files changed:', ids.toString());
      if (ids.every(matchIgnorePaths)) {
        return console.log('[racer-bundle] File explicitly Ignored. Skipping rebundle');
      }
      callBundle(this, bundleCachePath, minify, options.onRebundle);
    });
  }

  callBundle(b, bundleCachePath, minify, cb);
}

function callBundle(b, cachePath, minify, cb) {

  function readOrSetCache(buffer) {
    if (buffer) {
      b.write()
      fs.writeFileSync(cachePath, buffer)
    } else {
      buffer = fs.readFileSync(cachePath);
    }
    return buffer
  }

  b.bundle(function(err, buffer) {
    if (err) return cb(err);
    if (cachePath) buffer = readOrSetCache(buffer);
    // Extract the source map, which Browserify includes as a comment
    var source = buffer.toString('utf8');
    var map = convertSourceMap.fromSource(source, true).toJSON();
    source = removeSourceMapComments(source)
    if (!minify) return cb(null, source, map);

    // If inSourceMap is a string it is assumed to be a filename, but passing in
    // as an object avoids the need to make a file
    var inSourceMap = JSON.parse(map);
    var result = uglify.minify(source, {
      fromString: true,
      outSourceMap: 'map',
      inSourceMap: inSourceMap,
      compress: false
    });

    var mapObject = JSON.parse(result.map);
    // Uglify doesn't include the source content in the map, so copy over from
    // the map that browserify generates. However, before doing this, we must
    // first remove any empty sourceContent items since UglifyJS ignores those
    // files when populating the outSourceMap.sources array.
    mapObject.sourcesContent = inSourceMap.sourcesContent.filter(isNotEmptyString)
    if (mapObject.sources.length != mapObject.sourcesContent.length) {
      console.error('Invalid sourcemap detected. sources.length does not match sourcesContent.length')
    }
    var map = JSON.stringify(mapObject);
    cb(null, result.code, map);
  });
}

function isNotEmptyString(str) { return str !== '' }

function removeSourceMapComments(content) {
  var lines = content.split('\n');
  var line;
  // find all lines which contain a source map starting at end of content
  for (var i = lines.length - 1; i > 0; i--) {
    line = lines[i]
    if (line.includes('sourceMappingURL=')) lines[i] = ''
  }
  return lines.join('\n')
}

function hashFilename(filename) {
  return crypto.createHash('md5').update(filename).digest('hex');
}
