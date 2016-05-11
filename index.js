var path = require('path');
var fs = require('fs');
var browserify = require('browserify');
var watchify = require('watchify');
var uglify = require('uglify-js');
var convertSourceMap = require('convert-source-map');
var anymatch = require('anymatch');

var util;
module.exports = function(racer) {
  var Backend = racer.Backend || racer.Store;
  Backend.prototype.bundle = bundle;
  util = racer.util;
};

function bundle(file, options, cb) {
  if (typeof options === 'function') {
    cb = options;
    options = null;
  }
  options || (options = {});
  options.debug = true;
  var minify = (options.minify == null) ? util.isProduction : options.minify;
  // These objects need to be defined otherwise watchify disables its cache
  options.cache = {};
  options.packageCache = {};

  var b = browserify(options);
  this.emit('bundle', b);
  b.add(file);

  // If onRebundle is defined, watch the bundle for changes
  if (options.onRebundle) {
    var w = watchify(b, {
      delay: 100,
    });

    w.on('log', function (msg) {
      console.log(file + ' bundled:', msg);
    });

    var ignore = (options.ignore == null) ? [] : options.ignore
    // Chokidar/watchify provide the realpath's of files as their ids, so we
    //  add any realpath values that don't match the provided filepath's.
    ignore.forEach(function(filepath) {
      var realpath = fs.realpathSync(filepath);
      if (realpath !== filepath) ignore.push(realpath);
    });
    var matchIgnorePaths = anymatch(ignore)
    // This gets fired every time a dependent file is changed
    w.on('update', function(ids) {
      console.log('Files changed:', ids.toString());
      // If all the changed files are ignoreable, return before bundling
      if (ids.every(matchIgnorePaths)) {
        return console.log('Ignoring update')
      }
      callBundle(this, minify, options.onRebundle);
    });

    callBundle(w, minify, cb);
  } else {
    callBundle(b, minify, cb);
  }
}

function callBundle(b, minify, cb) {
  b.bundle(function(err, buffer) {
    if (err) return cb(err);
    // Extract the source map, which Browserify includes as a comment
    var source = buffer.toString('utf8');
    var map = convertSourceMap.fromSource(source).toJSON();
    source = convertSourceMap.removeComments(source);
    if (!minify) return cb(null, source, map);

    // If inSourceMap is a string it is assumed to be a filename, but passing in
    // as an object avoids the need to make a file
    var inSourceMap = JSON.parse(map);
    var result = uglify.minify(source, {
      fromString: true,
      outSourceMap: 'map',
      inSourceMap: inSourceMap
    });
    // Uglify doesn't include the source content in the map, so copy over from
    // the map that browserify generates
    var mapObject = JSON.parse(result.map);
    mapObject.sourcesContent = inSourceMap.sourcesContent;
    var map = JSON.stringify(mapObject);
    cb(null, result.code, map);
  });
}
