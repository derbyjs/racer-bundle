var expect = require('expect.js');
var racer = require('racer');
var plugin = require('../index');

describe('bundle', function() {

  it('adds a bundle method to stores', function() {
    var backend = racer.createBackend();
    expect(backend.bundle).equal(undefined);
    racer.use(plugin);
    expect(backend.bundle).to.be.a('function');
  });

});
