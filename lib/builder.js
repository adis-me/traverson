'use strict';

var standardRequest = require('request')
var util = require('util')
var JsonWalker = require('./json_walker')
var JsonHalWalker = require('./json_hal_walker')
var minilog = require('minilog')
var mediaTypes = require('./media_types')

var log = minilog('traverson')

function Builder(mediaType, startUri) {
  this.walker = this.createWalker(mediaType)
  this.walker.startUri = startUri
  this.walker.request = this.request = standardRequest
}

Builder.prototype.createWalker = function(mediaType) {
  switch (mediaType) {
  case mediaTypes.JSON:
    log.debug('creating new JsonWalker')
    return new JsonWalker()
  case mediaTypes.JSON_HAL:
    log.debug('creating new JsonHalWalker')
    return new JsonHalWalker()
  default:
    throw new Error('Unknown or unsupported media type: ' + mediaType)
  }
}

Builder.prototype.follow = function() {
  if (arguments.length === 1 && util.isArray(arguments[0])) {
    this.walker.links = arguments[0]
  } else {
    this.walker.links = Array.prototype.slice.apply(arguments)
  }
  return this
}

Builder.prototype.walk = Builder.prototype.follow

Builder.prototype.withTemplateParameters = function(parameters) {
  this.walker.templateParameters = parameters
  return this
}

Builder.prototype.withRequestOptions = function(options) {
  this.walker.request = this.request = standardRequest.defaults(options)
  return this
}

Builder.prototype.get = function(callback) {
  var self = this
  this.walker.walk(function(err, nextStep, lastStep) {
    log.debug('walker.walk returned')
    if (err) { return callback(err, lastStep.response, lastStep.uri) }
    log.debug('next step: ' + JSON.stringify(nextStep))
    self.walker.process(nextStep, function(err, step) {
      log.debug('walker.process returned')
      if (err) { return callback(err, step.response, step.uri) }
      if (!step.response && step.doc) {
        log.debug('faking HTTP response for embedded resource')
        step.response = {
          statusCode: 200,
          body: JSON.stringify(step.doc),
          remark: 'This is not an actual HTTP response. The resource you ' +
            'requested was an embedded resource, so no HTTP request was ' +
            'made to acquire it.'
        }
      }
      // log.debug('returning response')
      callback(null, step.response)
    })
  })
}

/*
 * Special variant of get() that does not yield the full http response to the
 * callback but instead the already parsed JSON as an object.
 */
Builder.prototype.getResource = function(callback) {
  var self = this
  this.walker.walk(function(err, nextStep, lastStep) {
    // TODO Remove duplication: This duplicates the get/checkHttpStatus/parse
    // sequence from the Walker's walk method.
    log.debug('walker.walk returned')
    if (err) { return callback(err, lastStep.response, lastStep.uri) }
    log.debug('next step: ' + JSON.stringify(nextStep))
    self.walker.process(nextStep, function(err, step) {
      log.debug('walker.process returned')
      if (err) { return callback(err, step.response, step.uri) }
      log.debug('resulting step: ' + step.uri)
      // log.debug('resulting step: ' + JSON.stringify(step))

      if (step.doc) {
        // return an embedded doc immediately
        return callback(null, step.doc)
      }

      var resource
      try {
        self.walker.checkHttpStatus(step)
        resource = self.walker.parse(step)
        return callback(null, resource)
      } catch (e) {
        return callback(e, e.doc)
      }
    })
  })
}

/*
 * Special variant of get() that does not execute the last request but instead
 * yields the last URI to the callback.
 */

Builder.prototype.getUri = function(callback) {
  var self = this
  this.walker.walk(function(err, nextStep, lastStep) {
    log.debug('walker.walk returned')
    if (err) { return callback(err, lastStep.response, lastStep.uri) }
    log.debug('returning uri')
    if (nextStep.uri) {
      return callback(null, nextStep.uri)
    } else if (nextStep.doc &&
      nextStep.doc._links &&
      nextStep.doc._links.self &&
      nextStep.doc._links.self.href) {
      return callback(null, self.walker.startUri +
          nextStep.doc._links.self.href)
    } else {
      return callback(new Error('You requested an URI but the last ' +
          'resource is an embedded resource and has no URI of its own ' +
          '(that is, it has no link with rel=\"self\"'))
    }
  })
}

Builder.prototype.post = function(body, callback) {
  this.walkAndExecute(body, this.request.post, callback)
}

Builder.prototype.put = function(body, callback) {
  this.walkAndExecute(body, this.request.put, callback)
}

Builder.prototype.patch = function(body, callback) {
  this.walkAndExecute(body, this.request.patch, callback)
}

Builder.prototype.delete = function(callback) {
  this.walkAndExecute(null, this.request.del, callback)
}

Builder.prototype.walkAndExecute = function(body, method, callback) {
  var self = this
  this.walker.walk(function(err, nextStep, lastStep) {
    log.debug('walker.walk returned')
    if (err) { return callback(err, lastStep.response, lastStep.uri) }
    log.debug('executing final request with step: ' +
        JSON.stringify(nextStep))
    self.executeRequest(nextStep.uri, method, body, callback)
  })
}

Builder.prototype.executeRequest = function(uri, method, body,
    callback) {
  var options
  if (body) {
    options = { body: JSON.stringify(body) }
  } else {
    options = {}
  }
  log.debug('request to ' + uri + ' with options ' + JSON.stringify(options))
  method.call(this.request, uri, options, function(err, response) {
    log.debug('request to ' + uri + ' succeeded')
    if (err) { return callback(err, response, uri) }
    return callback(null, response, uri)
  })
}

module.exports = Builder