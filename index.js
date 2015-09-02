var browserify = require('browserify');
var uglify = require('uglify-js');
var watchify = require('watchify');
var convertSourceMap = require('convert-source-map');

var util;
module.exports = function(racer) {
  racer.Store.prototype.bundle = bundle;
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

  // ignore derby views since they are updated seperately.
  var w = watchify(b, {delay: 100, ignoreWatch: '**/derby/lib/*_views.js'});

  w.on('log', function (msg) {
    console.log(file + ' bundled:', msg);
  });

  // If onRebundle is defined, then we need to watch the bundle for changes
  if (options.onRebundle) {
    // This gets fired everytime a dependent file is changed
    w.on('update', function(ids) {
      console.log('Files changed:', ids.toString());
      this.bundle(function(err, source) {
        if (err) return cb(err);
        // Extract the source map, which Browserify includes as a comment
        source = source.toString('utf8');
        var map = convertSourceMap.fromSource(source).toJSON();
        source = convertSourceMap.removeComments(source);
        if (minify) {
          uglified = minifySource(source, map);
          options.onRebundle(uglified.code, uglified.map, options);
        } else {
          options.onRebundle(source, map, options);
        }
      });
    });
  }

  // Kick-off the initial bundle
  w.bundle(function(err, source) {
    if (err) return cb(err);
    // Extract the source map, which Browserify includes as a comment
    source = source.toString('utf8');
    var map = convertSourceMap.fromSource(source).toJSON();
    source = convertSourceMap.removeComments(source);
    if (minify) {
      uglified = minifySource(source, map);
      cb(null, uglified.code, uglified.map);
    } else {
      cb(null, source, map);
    }
  });
}

function minifySource(source, map) {
  uglifyOpts = {};
  uglifyOpts.fromString = true;
  uglifyOpts.outSourceMap = 'map';
  // If inSourceMap is a string it is assumed to be a filename, but passing
  // in as an object avoids the need to make a file
  uglifyOpts.inSourceMap = JSON.parse(map);
  var result = uglify.minify(source, uglifyOpts);
  // Uglify doesn't include the source content in the map, so copy over from
  // the map that browserify generates
  var mapObject = JSON.parse(result.map);
  mapObject.sourcesContent = uglifyOpts.inSourceMap.sourcesContent;
  return {
    code: result.code,
    map: JSON.stringify(mapObject)
  };
}
