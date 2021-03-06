const sinon = require('sinon');
const {Tracer, ExplicitContext} = require('zipkin');
const Hapi = require('hapi');
const middleware = require('../src/hapiMiddleware');

describe('hapi middleware - integration test', () => {
  it('should receive trace info from the client', done => {
    const record = sinon.spy();
    const recorder = {record};
    const ctxImpl = new ExplicitContext();
    const tracer = new Tracer({recorder, ctxImpl});

    ctxImpl.scoped(() => {
      const server = new Hapi.Server();
      server.route({
        method: 'POST',
        path: '/foo',
        config: {
          handler: (request, reply) => reply.response({status: 'OK'}).code(202)
        }
      });
      server.register({
        plugin: middleware,
        options: {tracer, serviceName: 'service-a'}
      })
        .then(() => {
          const method = 'POST';
          const url = '/foo';
          const headers = {
            'X-B3-TraceId': 'aaa',
            'X-B3-SpanId': 'bbb',
            'X-B3-Flags': '1'
          };
          return server.inject({method, url, headers});
        })
        .then(() => {
          const annotations = record.args.map((args) => args[0]);
          annotations.forEach((ann) => expect(ann.traceId.traceId).to.equal('aaa'));
          annotations.forEach((ann) => expect(ann.traceId.spanId).to.equal('bbb'));

          expect(annotations[0].annotation.annotationType).to.equal('ServiceName');
          expect(annotations[0].annotation.serviceName).to.equal('service-a');

          expect(annotations[1].annotation.annotationType).to.equal('Rpc');
          expect(annotations[1].annotation.name).to.equal('POST');

          expect(annotations[2].annotation.annotationType).to.equal('BinaryAnnotation');
          expect(annotations[2].annotation.key).to.equal('http.path');
          expect(annotations[2].annotation.value).to.equal('/foo');

          expect(annotations[3].annotation.annotationType).to.equal('ServerRecv');

          expect(annotations[4].annotation.annotationType).to.equal('LocalAddr');

          expect(annotations[5].annotation.annotationType).to.equal('BinaryAnnotation');
          expect(annotations[5].annotation.key).to.equal('http.status_code');
          expect(annotations[5].annotation.value).to.equal('202');

          expect(annotations[6].annotation.annotationType).to.equal('ServerSend');

          done();
        })
        .catch((err) => {
          done(err);
        });
    });
  });

  it('should not crash on 404', done => {
    const record = sinon.spy();
    const recorder = {record};
    const ctxImpl = new ExplicitContext();
    const tracer = new Tracer({recorder, ctxImpl});

    ctxImpl.scoped(() => {
      const server = new Hapi.Server();
      server.register({
        plugin: middleware,
        options: {tracer, serviceName: 'service-a'}
      })
      .then(() => {
        const method = 'POST';
        const url = '/foo';
        return server.inject({method, url});
      })
      .then(() => {
        const annotations = record.args.map((args) => args[0]);
        expect(annotations[5].annotation.annotationType).to.equal('BinaryAnnotation');
        expect(annotations[5].annotation.key).to.equal('http.status_code');
        expect(annotations[5].annotation.value).to.equal('404');
        done();
      })
      .catch((err) => {
        done(err);
      });
    });
  });

  it('should properly report the URL with a query string', done => {
    const record = sinon.spy();
    const recorder = {record};
    const ctxImpl = new ExplicitContext();
    const tracer = new Tracer({recorder, ctxImpl});

    ctxImpl.scoped(() => {
      const server = new Hapi.Server();
      const path = '/foo';
      server.route({
        method: 'GET',
        path: '/foo',
        config: {
          handler: (request, reply) => reply.response({status: 'OK'}).code(202)
        }
      });
      server.register({
        plugin: middleware,
        options: {tracer, serviceName: 'service-a'}
      })
      .then(() => {
        const method = 'GET';
        const url = '/foo?abc=123';
        return server.inject({method, url});
      })
      .then(() => {
        const annotations = record.args.map(args => args[0]);

        expect(annotations[2].annotation.annotationType).to.equal('BinaryAnnotation');
        expect(annotations[2].annotation.key).to.equal('http.path');
        expect(annotations[2].annotation.value).to.equal(path);

        done();
      })
      .catch((err) => {
        done(err);
      });
    });
  });

  it('should record a reasonably accurate span duration', done => {
    const record = sinon.spy();
    const recorder = {record};
    const ctxImpl = new ExplicitContext();
    const tracer = new Tracer({recorder, ctxImpl});
    const PAUSE_TIME_MILLIS = 100;

    ctxImpl.scoped(() => {
      const server = new Hapi.Server();
      server.route({
        method: 'POST',
        path: '/foo',
        config: {
          handler: (request, reply) =>
            new Promise(resolve => {
              setTimeout(
                () => resolve(reply.response({status: 'OK'}).code(202)),
                PAUSE_TIME_MILLIS);
            })
        }
      });

      server.register({
        plugin: middleware,
        options: {tracer, serviceName: 'service-a'}
      })
      .then(() => {
        const method = 'POST';
        const url = '/foo';
        return server.inject({method, url});
      })
      .then(() => {
        const annotations = record.args.map((args) => args[0]);
        const serverRecvTs = annotations[3].timestamp / 1000.0;
        const serverSendTs = annotations[6].timestamp / 1000.0;
        const durationMillis = (serverSendTs - serverRecvTs);
        expect(durationMillis).to.be.greaterThan(PAUSE_TIME_MILLIS);
        done();
      })
      .catch((err) => {
        done(err);
      });
    });
  });
});
