'use strict';

const moment = require('moment');
const util = require('util');
const path = require('path');
const config = require('config');
const fs = require('fs');
const log = require('log')();
const jade = require('jade');
const _ = require('lodash');
const assert = require('assert');
const JadeParserMultipleDirs = require('lib/jadeParserMultipleDirs');

require('lib/requireJade');

// public.versions.json is regenerated and THEN node is restarted on redeploy
// so it loads a new version.
var publicVersions;

function getPublicVersion(publicPath) {
  if (!publicVersions) {
    // don't include at module top, let the generating task to finish
    publicVersions = require(path.join(config.projectRoot, 'public.versions.json'));
  }
  var busterPath = publicPath.slice(1);
  return publicVersions[busterPath];
}

function addStandardHelpers(locals, ctx) {
  locals.moment = moment;

  locals.parser = JadeParserMultipleDirs;

  // csrf only generated on request
  // use:
  //   script var csrf = !{JSON.stringify(csrf.token)}
  // when I use a variable in jade, it's code analyzer (addWith, "with" module)
  // detects the variable and uses it in the wrapping function, effectively triggering it's evaluation
  // so I assign getter not to "csrf", but to "csrf.token", which will only be asked by "csrf.token", not a wrapper
  locals.csrf = {
    token: {
      get: function() {
        if (!ctx.req.user) {
          // csrf generates session.secret
          // we don't create session for anonymouse users (varnish cache)
          // so we don't want csrf token for them
          // (it's not needed for anonymous guys anyway)
          throw new Error("Shouldn't ask for CSRF token when anonymouse user (it will require to make a session)");
        }
        var csrf = ctx.csrf;
        assert(csrf);
        return csrf;
      }
    }
  };

  // we don't use defer in sessions, so can assign it
  // (simpler, need to call yield this.session)
  // (anon users may stop on varnish anyway)
  locals.session = ctx.session;

  Object.defineProperty(locals, "user", {
    get: function() {
      return ctx.req.user;
    }
  });

  // this.locals.debug causes jade to dump function
  /* jshint -W087 */
  locals.deb = function() {
    debugger;
  };

  locals.bem = require('bem-jade')();

  locals.asset = function(publicPath) {
    if (publicPath[0] != '/') {
      throw new Error("asset needs an /absolute/path");
    }
    var version = getPublicVersion(publicPath);
    if (!version) {
      version = Math.random().toString().slice(2);
      log.error("No version for " + publicPath);
    }
    return config.staticHost + publicPath.replace('.', '.v' + version + '.');
  };


  locals.script = function(name) {
    var versions = JSON.parse(
      fs.readFileSync(path.join(config.manifestRoot, 'js.versions.json'), {encoding: 'utf-8'})
    );
    var versionName = versions[name];

    return versionName;
  };

  locals.style = function(name) {
    var versions = JSON.parse(
      fs.readFileSync(path.join(config.manifestRoot, 'styles.versions.json'), {encoding: 'utf-8'})
    );
    var versionName = versions[name];

    return versionName;
  };

//  locals.debug = true;
}


// (!) this.render does not assign this.body to the result
// that's because render can be used for different purposes, e.g to send emails
module.exports = function render(app) {
  app.use(function *(next) {
    var ctx = this;

    this.locals = _.assign({}, config.template.options);

    this.templatePaths = [path.join(config.projectRoot, 'templates')];

    // render('article', {})  -- 2 args
    // render('article')
    this.render = function(templatePath, locals) {

      // add helpers at render time, not when middleware is used time
      // probably we will have more stuff initialized here
      addStandardHelpers(this.locals, this);

      this.log.debug("Lookup " + templatePath + " in " + this.templatePaths);

      // warning!
      // _.assign does NOT copy defineProperty
      // so I use this.locals as a root and merge all props in it, instead of cloning this.locals
      var loc = Object.create(this.locals);
      loc.templatePaths = this.templatePaths;

      _.assign(loc, locals);

      var templatePathResolved;
      for (var i = 0; i < this.templatePaths.length; i++) {
        templatePathResolved = path.join(this.templatePaths[i], templatePath);
        if (path.extname(templatePathResolved) === '') templatePathResolved += '.jade';
        if (fs.existsSync(templatePathResolved)) break;
      }

      if (i == this.templatePaths.length) {
        throw new Error("Template file not found: " + templatePath + " (in dirs " + this.templatePaths + ") ");
      }

      this.log.debug("render file " + templatePathResolved);
      return jade.renderFile(templatePathResolved, loc);
    };


    yield next;
  });

};
