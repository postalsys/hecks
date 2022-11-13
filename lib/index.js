'use strict';

const Bounce = require('@hapi/bounce');
const Toys = require('@postalsys/toys');
const Package = require('../package.json');

const internals = {};

exports.plugin = {
    pkg: Package,
    once: true,
    requirements: {
        hapi: '>=19'
    },
    register(server) {

        const express = internals.express.bind();   // clone handler definition
        express.defaults = internals.routeDefaults; // set route defaults for use with this handler

        server.decorate('handler', 'express', express);
    }
};

exports.toPlugin = (handlerOpts, nameOrAttrs) => {

    const attributes = (typeof nameOrAttrs === 'string') ? { name: nameOrAttrs } : nameOrAttrs;

    return Object.assign({}, attributes, {
        async register(srv) {

            const hecks = exports;

            await srv.register(hecks);

            srv.route({
                method: '*',
                path: '/{expressPath*}',
                handler: { express: handlerOpts }
            });
        }
    });
};

internals.express = (route, options) => {

    if (typeof options === 'function') {
        options = { app: options };
    }

    const app = options.app;
    const express = options.express || require('express');
    const handlerApp = express();

    // An undefined expressPath may mean '/' or that there is no such param, so we
    // detect this upfront.  If there is no such param then rely on express mounting
    // for the entire url rewrite.  That means, if there's a hapi plugin route prefix
    // then that prefix will need to be preserved by expressPathMiddleware().

    if (route.path !== '/{expressPath*}' && route.path.match(/\{expressPath(?:(\*)(\d+)?)?(\?)?\}/)) {
        handlerApp.use(internals.expressPathMiddleware);
    }

    // Restore req/res methods potentially used by shot, see hapijs/shot#82
    handlerApp.use(internals.restoreForShotMiddleware);

    // Mount the app at the route path prefix
    handlerApp.use(route.realm.modifiers.route.prefix || '/', app);

    return async (request, h) => {

        const { req, res } = request.raw;

        req[internals.kHecks] = { request };
        res[internals.kHecks] = {};

        // Stash req/res methods potentially used by shot, see hapijs/shot#82
        internals.stashForShot(req, res);

        // Aw, heck!
        handlerApp(req, res);

        try {
            await Toys.stream(res);
        }
        catch (err) {
            Bounce.rethrow(err, 'system');
            return h.close;
        }

        return h.abandon;
    };
};

internals.routeDefaults = {
    payload: {
        parse: false,       // Default to not parse payload or cookies
        output: 'stream'
    },
    state: {
        parse: false
    }
};

internals.expressPathMiddleware = (req, res, next) => {

    const { request } = req[internals.kHecks];
    const expressPath = request.params.expressPath || '';
    const prefix = request.route.realm.modifiers.route.prefix || '';
    const search = request.url.search || '';

    req.url = `${prefix}/${expressPath}${search}`;

    next();
};

internals.restoreForShotMiddleware = (req, res, next) => {

    req._read = req[internals.kHecks]._read;
    req.destroy = req[internals.kHecks].destroy;

    res.write = res[internals.kHecks].write;
    res.end = res[internals.kHecks].end;
    res.writeHead = res[internals.kHecks].writeHead;
    res.destroy = res[internals.kHecks].destroy;

    next();
};

internals.stashForShot = (req, res) => {

    req[internals.kHecks]._read = req._read;
    req[internals.kHecks].destroy = req.destroy;

    res[internals.kHecks].write = res.write;
    res[internals.kHecks].end = res.end;
    res[internals.kHecks].writeHead = res.writeHead;
    res[internals.kHecks].destroy = res.destroy;
};

internals.kHecks = Symbol('hecks');
