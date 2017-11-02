'use strict'

const test = require('tape')
const handler = require('./')
const through2 = require('through2')
const series = require('run-series')

function mkReq (url, method) {
  const req = through2()
  req.method = method || 'POST'
  req.url = url
  req.headers = {
    'x-hub-signature': 'bogus',
    'x-github-event': 'bogus',
    'x-github-delivery': 'bogus'
  }
  return req
}

function mkRes () {
  const res = {
    writeHead: function (statusCode, headers) {
      res.$statusCode = statusCode
      res.$headers = headers
    },

    end: function (content) {
      res.$end = content
    }
  }

  return res
}

test('handler without full options throws', function (t) {
  t.plan(4)

  t.equal(typeof handler, 'function', 'handler exports a function')

  t.throws(handler, /must provide an options object/, 'throws if no options')

  t.throws(handler.bind(null, {}), /must provide a 'path' option/, 'throws if no path option')

  t.throws(handler.bind(null, { path: '/' }), /must provide a 'secret' option/, 'throws if no secret option')
})

test('handler ignores invalid urls', function (t) {
  const options = { path: '/some/url', secret: 'bogus' }
  const h = handler(options)

  t.plan(6)

  h(mkReq('/'), mkRes(), function (err) {
    t.error(err)
    t.ok(true, 'request was ignored')
  })

  // near match
  h(mkReq('/some/url/'), mkRes(), function (err) {
    t.error(err)
    t.ok(true, 'request was ignored')
  })

  // partial match
  h(mkReq('/some'), mkRes(), function (err) {
    t.error(err)
    t.ok(true, 'request was ignored')
  })
})

test('handler ingores non-POST requests', function (t) {
  const options = { path: '/some/url', secret: 'bogus' }
  const h = handler(options)

  t.plan(4)

  h(mkReq('/some/url', 'GET'), mkRes(), function (err) {
    t.error(err)
    t.ok(true, 'request was ignored')
  })

  h(mkReq('/some/url?test=param', 'GET'), mkRes(), function (err) {
    t.error(err)
    t.ok(true, 'request was ignored')
  })
})

test('handler accepts valid urls', function (t) {
  const options = { path: '/some/url', secret: 'bogus' }
  const h = handler(options)

  t.plan(1)

  h(mkReq('/some/url'), mkRes(), function (err) {
    t.error(err)
    t.fail(false, 'should not call')
  })

  h(mkReq('/some/url?test=param'), mkRes(), function (err) {
    t.error(err)
    t.fail(false, 'should not call')
  })

  setTimeout(t.ok.bind(t, true, 'done'))
})

test('handler can reject events', function (t) {
  const acceptableEvents = {
    'undefined': undefined,
    'a string equal to the event': 'bogus',
    'a string equal to *': '*',
    'an array containing the event': ['bogus'],
    'an array containing *': ['not-bogus', '*']
  }
  const unacceptableEvents = {
    'a string not equal to the event or *': 'not-bogus',
    'an array not containing the event or *': ['not-bogus']
  }
  const acceptable = Object.keys(acceptableEvents)
  const unacceptable = Object.keys(unacceptableEvents)
  const acceptableTests = acceptable.map(function (events) {
    return acceptableReq.bind(null, events)
  })
  const unacceptableTests = unacceptable.map(function (events) {
    return unacceptableReq.bind(null, events)
  })

  t.plan(acceptable.length + unacceptable.length)
  series(acceptableTests.concat(unacceptableTests))

  function acceptableReq (events, callback) {
    const h = handler({
      path: '/some/url',
      secret: 'bogus',
      events: acceptableEvents[events]
    })

    h(mkReq('/some/url'), mkRes(), function (err) {
      t.error(err)
      t.fail(false, 'should not call')
    })

    setTimeout(function () {
      t.ok(true, 'accepted because options.events was ' + events)
      callback()
    })
  }

  function unacceptableReq (events, callback) {
    const h = handler({
      path: '/some/url',
      secret: 'bogus',
      events: unacceptableEvents[events]
    })

    h.on('error', function () {})

    h(mkReq('/some/url'), mkRes(), function (err) {
      t.ok(err, 'rejected because options.events was ' + events)
      callback()
    })
  }
})

// because we don't inherit in a traditional way
test('handler is an EventEmitter', function (t) {
  t.plan(5)

  const h = handler({ path: '/', secret: 'bogus' })

  t.equal(typeof h.on, 'function', 'has h.on()')
  t.equal(typeof h.emit, 'function', 'has h.emit()')
  t.equal(typeof h.removeListener, 'function', 'has h.removeListener()')

  h.on('ping', function (pong) {
    t.equal(pong, 'pong', 'got event')
  })

  h.emit('ping', 'pong')

  t.throws(h.emit.bind(h, 'error', new Error('threw an error')), /threw an error/, 'acts like an EE')
})

test('handler accepts a signed blob', function (t) {
  t.plan(4)

  const obj = { some: 'github', object: 'with', properties: true }
  const json = JSON.stringify(obj)
  const h = handler({ path: '/', secret: 'bogus' })
  const req = mkReq('/')
  const res = mkRes()

  req.headers['x-hub-signature'] = h.sign(json)
  req.headers['x-github-event'] = 'push'

  h.on('push', function (event) {
    t.deepEqual(event, { event: 'push', id: 'bogus', payload: obj, url: '/', host: undefined, protocol: undefined })
    t.equal(res.$statusCode, 200, 'correct status code')
    t.deepEqual(res.$headers, { 'content-type': 'application/json' })
    t.equal(res.$end, '{"ok":true}', 'got correct content')
  })

  h(req, res, function (err) {
    t.error(err)
    t.fail(true, 'should not get here!')
  })

  process.nextTick(function () {
    req.end(json)
  })
})

test('handler accepts a signed blob with alt event', function (t) {
  t.plan(4)

  const obj = { some: 'github', object: 'with', properties: true }
  const json = JSON.stringify(obj)
  const h = handler({ path: '/', secret: 'bogus' })
  const req = mkReq('/')
  const res = mkRes()

  req.headers['x-hub-signature'] = h.sign(json)
  req.headers['x-github-event'] = 'issue'

  h.on('push', function (event) {
    t.fail(true, 'should not get here!')
  })

  h.on('issue', function (event) {
    t.deepEqual(event, { event: 'issue', id: 'bogus', payload: obj, url: '/', host: undefined, protocol: undefined })
    t.equal(res.$statusCode, 200, 'correct status code')
    t.deepEqual(res.$headers, { 'content-type': 'application/json' })
    t.equal(res.$end, '{"ok":true}', 'got correct content')
  })

  h(req, res, function (err) {
    t.error(err)
    t.fail(true, 'should not get here!')
  })

  process.nextTick(function () {
    req.end(json)
  })
})

test('handler rejects a badly signed blob', function (t) {
  t.plan(6)

  const obj = { some: 'github', object: 'with', properties: true }
  const json = JSON.stringify(obj)
  const h = handler({ path: '/', secret: 'bogus' })
  const req = mkReq('/')
  const res = mkRes()

  req.headers['x-hub-signature'] = h.sign(json)
  // break signage by a tiny bit
  req.headers['x-hub-signature'] = '0' + req.headers['x-hub-signature'].substring(1)

  h.on('error', function (err, _req) {
    t.ok(err, 'got an error')
    t.strictEqual(_req, req, 'was given original request object')
    t.equal(res.$statusCode, 400, 'correct status code')
    t.deepEqual(res.$headers, { 'content-type': 'application/json' })
    t.equal(res.$end, '{"error":"X-Hub-Signature does not match blob signature"}', 'got correct content')
  })

  h.on('push', function (event) {
    t.fail(true, 'should not get here!')
  })

  h(req, res, function (err) {
    t.ok(err, 'got error on callback')
  })

  process.nextTick(function () {
    req.end(json)
  })
})

test('handler responds on a bl error', function (t) {
  t.plan(4)

  const obj = { some: 'github', object: 'with', properties: true }
  const json = JSON.stringify(obj)
  const h = handler({ path: '/', secret: 'bogus' })
  const req = mkReq('/')
  const res = mkRes()

  req.headers['x-hub-signature'] = h.sign(json)
  req.headers['x-github-event'] = 'issue'

  h.on('push', function (event) {
    t.fail(true, 'should not get here!')
  })

  h.on('issue', function (event) {
    t.fail(true, 'should never get here!')
  })

  h.on('error', function (err) {
    t.ok(err, 'got an error')
    t.equal(res.$statusCode, 400, 'correct status code')
  })

  h(req, res, function (err) {
    t.ok(err)
  })

  res.end = function () {
    t.equal(res.$statusCode, 400, 'correct status code')
  }

  req.write('{')
  process.nextTick(function () {
    req.emit('error', new Error('simulated explosion'))
  })
})

test('handler exposes sign and verify methods', function (t) {
  t.plan(3)

  var h = handler({ path: '/', secret: 'bogus' })
  var json = JSON.stringify({foo: 'bar'})

  t.ok(h.verify(h.sign(json), json))
  t.ok(!h.verify(h.sign(json), 'nope'))
  t.ok(!h.verify(h.sign('nope'), json))
})
