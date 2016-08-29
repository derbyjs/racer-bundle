var anymatch = require('anymatch');
var browserify = require('browserify');
var convertSourceMap = require('convert-source-map');
var crypto = require('crypto');
var fs = require('fs');
var os = require('os');
var path = require('path');
var tmpdir = os.tmpdir()
var uglify = require('uglify-js');
var util;
var watchify = require('watchify-with-cache');

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

  var entryFileHash = hashFilename(entryFile);
  var ignorePaths = addRealPaths(options.ignore || []);
  var matchIgnorePaths = anymatch(ignorePaths);
  var minify = (options.minify == null) ? util.isProduction : options.minify;

  options.useCache = !!options.useCache || !!process.env.USE_CACHE
  var bundleCachePath = (options.useCache) ? getBundleCachePath(entryFileHash) : null

  if (options.clearCache || process.env.CLEAR_CACHE) {
    clearCacheFiles(entryFileHash);
  }

  // Create our browserify instance
  var b = browserify(getBrowserifyOptions(entryFileHash, options));
  b.add(entryFile);
  b.on('log', function (msg) {
    console.log(entryFile, 'log:', msg);
  });
  this.emit('bundle', b);

  var _callBundle = callBundle.bind(null, b, bundleCachePath, minify)
  var initialBundle = _callBundle.bind(null, cb)
  var rebundle = _callBundle.bind(null, options.onRebundle);

  // Wrap browserify with caching/watching logic if requested
  var useWatchify = options.onRebundle || options.useCache

  if (options.onRebundle) {
    wrapBundle(b, entryFileHash, ignorePaths, rebundle)
  }
  if (options.useCache) {
    wrapBundle(b, entryFileHash, ignorePaths)
  }

  initialBundle()
}

function wrapBundle(b, entryFileHash, ignorePaths, rebundle) {
  var watchifyOptions = {
    delay: 100,
    // The ignored paths should be checked by sha instead of mtime when deciding
    // if they are invalid. This prevents regenerating the view partials
    // from causing a rebundle if cached contents are equal
    checkShasum: ignorePaths,
    watch: !!rebundle,
    cacheFile: getModuleCachePath(entryFileHash)
  };
  watchify(b, watchifyOptions);
  // Rebundle whenever a file is changed unless explicitly ignored
  b.on('update', function(ids) {
    console.log('[racer-bundle] Files changed:', ids.toString());
    if (ids.every(matchIgnorePaths)) {
      console.log('[racer-bundle] File explicitly Ignored. Skipping rebundle');
    } else {
      rebundle()
    }
  });
}

function callBundle(b, cachePath, minify, cb) {
  b.bundle(function(err, buffer) {
    if (err) return cb(err);
    if (cachePath) buffer = readOrSetBundleCache(buffer);
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
      console.error('[racer-bundle] Invalid sourcemap detected. sources.length does not match sourcesContent.length')
    }
    var map = JSON.stringify(mapObject);
    cb(null, result.code, map);
  });

  // If buffer is provided, we update our cache and return the buffer.
  // If no buffer is provided, we return the buffer from our cache.
  function readOrSetBundleCache(buffer) {
    if (buffer) {
      b.write()
      fs.writeFileSync(cachePath, buffer)
    } else {
      buffer = fs.readFileSync(cachePath);
    }
    return buffer
  }
}

function getBrowserifyOptions(entryFileHash, options) {
  options = options || {};
  options.debug = true;
  options.packageCache = {};
  if (options.useCache) {
    options.fullPaths = true;
    options.cache = getModuleCache(entryFileHash);
  } else {
    options.cache = {};
  }
  return options
}

function addRealPaths(filePaths) {
  filePaths = filePaths.slice()
  filePaths.forEach(function(filepath) {
    // NOTE: Chokidar provides the realpath's of files as their ids, so we
    // have to add any realpath values that don't match the provided filepath's
    // to our ignore array
    if (fs.existsSync(filepath)) {
      var realpath = fs.realpathSync(filepath);
      if (realpath !== filepath) filePaths.push(realpath);
    }
  });
  return filePaths
}

function clearCacheFiles(entryFileHash) {
  fs.unlinkSync(getModuleCachePath(entryFileHash))
  fs.unlinkSync(getModuleCachePath(entryFileHash))
  console.log('[racer-bundle] Watchify cache cleared.')
}

function getModuleCache(entryFileHash) {
  console.log('[racer-bundle] Loading watchify cache')
  return watchify.getCache(getModuleCachePath(entryFileHash))
}

function getModuleCachePath(entryFileHash) {
  return path.resolve(tmpdir, entryFileHash + '.modules.cache.json');
}

function getBundleCachePath(entryFileHash) {
  return path.resolve(tmpdir, entryFileHash + '.bundle.cache.js');
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
