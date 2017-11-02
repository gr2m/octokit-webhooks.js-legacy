'use strict'

const EventEmitter = require('events')
const crypto = require('crypto')
const bl = require('bl')
const bufferEq = require('buffer-equal-constant-time')

function create (options) {
  if (typeof options !== 'object') {
    throw new TypeError('must provide an options object')
  }

  if (typeof options.path !== 'string') {
    throw new TypeError('must provide a \'path\' option')
  }

  if (typeof options.secret !== 'string') {
    throw new TypeError('must provide a \'secret\' option')
  }

  let events

  if (typeof options.events === 'string' && options.events !== '*') {
    events = [ options.events ]
  } else if (Array.isArray(options.events) && options.events.indexOf('*') === -1) {
    events = options.events
  }

  // make it an EventEmitter, sort of
  const emitter = new EventEmitter()
  handler.emit = emitter.emit.bind(emitter)
  handler.on = emitter.on.bind(emitter)
  handler.removeListener = emitter.removeListener.bind(emitter)

  handler.sign = sign
  handler.verify = verify

  return handler

  function sign (data) {
    return 'sha1=' + crypto.createHmac('sha1', options.secret).update(data).digest('hex')
  }

  function verify (signature, data) {
    return bufferEq(Buffer.from(signature), Buffer.from(sign(data)))
  }

  function handler (req, res, callback) {
    if (req.url.split('?').shift() !== options.path || req.method !== 'POST') {
      return callback()
    }

    function hasError (msg) {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: msg }))

      const err = new Error(msg)

      emitter.emit('error', err, req)
      callback(err)
    }

    const sig = req.headers['x-hub-signature']
    const event = req.headers['x-github-event']
    const id = req.headers['x-github-delivery']

    if (!sig) {
      return hasError('No X-Hub-Signature found on request')
    }

    if (!event) {
      return hasError('No X-Github-Event found on request')
    }

    if (!id) {
      return hasError('No X-Github-Delivery found on request')
    }

    if (events && events.indexOf(event) === -1) {
      return hasError('X-Github-Event is not acceptable')
    }

    req.pipe(bl(function (err, data) {
      if (err) {
        return hasError(err.message)
      }

      var obj

      if (!verify(sig, data)) {
        return hasError('X-Hub-Signature does not match blob signature')
      }

      try {
        obj = JSON.parse(data.toString())
      } catch (e) {
        return hasError(e)
      }

      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"ok":true}')

      const emitData = {
        event: event,
        id: id,
        payload: obj,
        protocol: req.protocol,
        host: req.headers['host'],
        url: req.url
      }

      emitter.emit(event, emitData)
      emitter.emit('*', emitData)
    }))
  }
}

module.exports = create
