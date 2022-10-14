// @format
const test = require("ava").serial;
const sqlite = require("better-sqlite3");
const session = require("express-session");
const { unlinkSync, existsSync } = require("fs");
const differenceInSeconds = require("date-fns/differenceInSeconds");
const add = require("date-fns/add");
const async_hooks = require("async_hooks");

const SqliteStore = require("../src/index.js")(session);

const dbName = "test.db";
const dbOptions = {
  verbose: console.log,
};

const teardown = () => {
  try {
    unlinkSync(dbName);
  } catch (err) {
    if (!existsSync(dbName)) {
      //noop
    } else {
      throw err;
    }
  }
};

test.afterEach(teardown);

test("if interface methods run safely when `cb` isn't present", (t) => {
  const db = new sqlite(dbName, dbOptions);
  const s = new SqliteStore({
    client: db,
  });

  s.all();
  s.destroy("non-existent");
  s.clear();
  s.length();
  s.get("non-existent");

  const sid = "123";
  const sess = { cookie: { maxAge: 2000 }, name: "sample name" };
  s.set(sid, sess);
  s.touch(sid, sess);
  t.pass();
});

test("if initializing store works", (t) => {
  const db = new sqlite(dbName, dbOptions);
  const s = new SqliteStore({
    client: db,
  });

  const [sid, sess, expire] = db.prepare("PRAGMA table_info (sessions)").all();
  t.assert(sid.name === "sid" && sid.type === "TEXT");
  t.assert(sess.name === "sess" && sess.type === "JSON");
  t.assert(expire.name === "expire" && expire.type === "TEXT");
});

test("if initialization can be run twice without any errors", (t) => {
  const db = new sqlite(dbName, dbOptions);
  const s = new SqliteStore({
    client: db,
  });
  const s2 = new SqliteStore({
    client: db,
  });

  const [sid, sess, expire] = db.prepare("PRAGMA table_info (sessions)").all();
  t.assert(sid.name === "sid" && sid.type === "TEXT");
  t.assert(sess.name === "sess" && sess.type === "JSON");
  t.assert(expire.name === "expire" && expire.type === "TEXT");
});

test("if error is thrown when client is missing from options", (t) => {
  t.throws(() => new SqliteStore());
});

test("if it saves a new session record", (t) => {
  const db = new sqlite(dbName, dbOptions);
  const s = new SqliteStore({
    client: db,
  });

  const sid = "123";
  const sess = { cookie: { maxAge: 5000 }, name: "sample name" };
  s.set(sid, sess, (err, rows) => {
    t.assert(!err);
    t.assert(rows);
  });

  const dbSess = db.prepare("SELECT * FROM sessions WHERE sid = ?").get(sid);
  t.assert(dbSess.sess === JSON.stringify(sess));
  t.assert(dbSess.sid === sid);
  const diff = differenceInSeconds(new Date(dbSess.expire), new Date());
  t.assert(diff * 1000 >= sess.cookie.maxAge - 1000);
});

test("if it overwrites an already-existing session", (t) => {
  const db = new sqlite(dbName, dbOptions);
  const s = new SqliteStore({
    client: db,
  });

  const sid = "123";
  const sess = { cookie: { maxAge: 2000 }, name: "sample name" };
  s.set(sid, sess, (err, rows) => {
    t.assert(!err);
    t.assert(rows);
  });

  const dbSess = db.prepare("SELECT * FROM sessions WHERE sid = ?").get(sid);
  t.assert(dbSess.sess === JSON.stringify(sess));
  t.assert(dbSess.sid === sid);

  const sess2 = { cookie: { maxAge: 5000 }, name: "replaced name" };
  s.set(sid, sess2, (err, rows) => {
    t.assert(!err);
    t.assert(rows);
  });
  const dbSess2 = db.prepare("SELECT * FROM sessions WHERE sid = ?").get(sid);
  t.assert(dbSess2.sess === JSON.stringify(sess2));
  t.assert(dbSess2.sid === sid);
});

test("if it saves a session with a missing maxAge too", (t) => {
  const db = new sqlite(dbName, dbOptions);
  const s = new SqliteStore({
    client: db,
  });

  const sid = "123";
  const sess = { cookie: {}, name: "sample name" };
  const oneDayAge = 86400;
  s.set(sid, sess, (err, rows) => {
    t.assert(!err);
    t.assert(rows);
  });

  const dbSess = db.prepare("SELECT * FROM sessions WHERE sid = ?").get(sid);
  t.assert(dbSess.sess === JSON.stringify(sess));
  t.assert(dbSess.sid === sid);
  t.assert(
    differenceInSeconds(new Date(dbSess.expire), new Date()) >= oneDayAge - 5
  );
});

test("if it saves a session with expires value (as Date object) set instead of maxAge", (t) => {
  const db = new sqlite(dbName, dbOptions);
  const s = new SqliteStore({
    client: db,
  });

  const sid = "123";
  const ttlSeconds = 5;
  const expires = new Date();
  expires.setSeconds(expires.getSeconds() + ttlSeconds);
  const sess = { cookie: { expires }, name: "sample name" };
  s.set(sid, sess, (err, rows) => {
    t.assert(!err);
    t.assert(rows);
  });

  const dbSess = db.prepare("SELECT * FROM sessions WHERE sid = ?").get(sid);
  t.assert(dbSess.sess === JSON.stringify(sess));
  t.assert(dbSess.sid === sid);

  const diff = differenceInSeconds(new Date(dbSess.expire), new Date());
  t.assert(diff >= ttlSeconds - 1 && diff <= ttlSeconds);
});

test("if it saves a session with expires value (as date string) set instead of maxAge", (t) => {
  const db = new sqlite(dbName, dbOptions);
  const s = new SqliteStore({
    client: db,
  });

  const sid = "123";
  const ttlSeconds = 5;
  const expires = new Date();
  expires.setSeconds(expires.getSeconds() + ttlSeconds);
  const sess = {
    cookie: { expires: expires.toISOString() },
    name: "sample name",
  };
  s.set(sid, sess, (err, rows) => {
    t.assert(!err);
    t.assert(rows);
  });

  const dbSess = db.prepare("SELECT * FROM sessions WHERE sid = ?").get(sid);
  t.assert(dbSess.sess === JSON.stringify(sess));
  t.assert(dbSess.sid === sid);

  const diff = differenceInSeconds(new Date(dbSess.expire), new Date());
  t.assert(diff >= ttlSeconds - 1 && diff <= ttlSeconds);
});

test("if the maxAge value takes precedence over the expires value", (t) => {
  const db = new sqlite(dbName, dbOptions);
  const s = new SqliteStore({
    client: db,
  });

  const sid = "123";
  const ttlSeconds = 5;
  const expires = new Date();
  expires.setSeconds(expires.getSeconds() + ttlSeconds);
  const sess = {
    cookie: { expires, maxAge: ttlSeconds * 1000 * 2 },
    name: "sample name",
  };
  s.set(sid, sess, (err, rows) => {
    t.assert(!err);
    t.assert(rows);
  });

  const dbSess = db.prepare("SELECT * FROM sessions WHERE sid = ?").get(sid);
  t.assert(dbSess.sess === JSON.stringify(sess));
  t.assert(dbSess.sid === sid);

  const diff = differenceInSeconds(new Date(dbSess.expire), new Date());
  t.assert(diff >= 2 * ttlSeconds - 1 && diff <= 2 * ttlSeconds);
});

test("if get method returns null when no session was found", (t) => {
  const db = new sqlite(dbName, dbOptions);
  const s = new SqliteStore({
    client: db,
  });

  s.get("non-existent", (err, res) => {
    t.assert(!err);
    t.assert(res === null);
  });
});

test("if an expired session is ignored when trying to get a session", async (t) => {
  const db = new sqlite(dbName, dbOptions);
  const s = new SqliteStore({
    client: db,
  });

  const sid = "123";
  // NOTE: Session expires immediately with maxAge being 1 second.
  const sess = { cookie: { maxAge: 1 }, name: "sample name" };
  s.set(sid, sess, (err, res) => {
    t.assert(!err);
    t.assert(res);
  });

  // NOTE: Wait 2 sec to make sure that session is expired.
  await new Promise((resolve) => setTimeout(resolve, 2000));

  s.get(sid, (err, res) => {
    t.assert(!err);
    t.assert(res === null);
  });
});

test("if an active session is retrieved when calling get", (t) => {
  const db = new sqlite(dbName, dbOptions);
  const s = new SqliteStore({
    client: db,
  });

  const sid = "123";
  const sess = { cookie: { maxAge: 100 * 1000 }, name: "sample name" };
  s.set(sid, sess, (err, res) => {
    t.assert(!err);
    t.assert(res);
  });

  s.get(sid, (err, dbSess) => {
    t.assert(!err);
    t.deepEqual(sess, dbSess);
  });
});

test("if a session is destroyed", (t) => {
  const db = new sqlite(dbName, dbOptions);
  const s = new SqliteStore({
    client: db,
  });

  const sid = "123";
  const sess = { cookie: { maxAge: 100 }, name: "sample name" };
  s.set(sid, sess, (err, res) => {
    t.assert(!err);
    t.assert(res);
  });

  s.destroy(sid, (err, res) => {
    t.assert(!err);
    t.assert(res);
  });

  const { numOfSessions } = db
    .prepare("SELECT COUNT(*) as numOfSessions FROM sessions")
    .get();
  t.assert(numOfSessions === 0);
});

test("if non-existent session can be destroyed without throwing an error too", (t) => {
  const db = new sqlite(dbName, dbOptions);
  const s = new SqliteStore({
    client: db,
  });
  const sid = "123";

  s.destroy(sid, (err, res) => {
    t.assert(!err);
    t.assert(res);
  });
});

test("if counting all sessions is possible", (t) => {
  const db = new sqlite(dbName, dbOptions);
  const s = new SqliteStore({
    client: db,
  });

  s.length((err, res) => {
    t.assert(typeof res === "number");
    t.assert(res === 0);
  });

  const sid = "123";
  const sess = { cookie: { maxAge: 100 }, name: "sample name" };
  s.set(sid, sess, (err, res) => {
    t.assert(!err);
    t.assert(res);
  });

  s.length((err, res) => {
    t.assert(typeof res === "number");
    t.assert(res === 1);
  });
});

test("if all sessions can be cleared", (t) => {
  const db = new sqlite(dbName, dbOptions);
  const s = new SqliteStore({
    client: db,
  });

  const sid = "123";
  const sid2 = "456";
  const sess = { cookie: { maxAge: 100 }, name: "sample name" };
  s.set(sid, sess, (err, res) => {
    t.assert(!err);
    t.assert(res);
  });
  s.set(sid2, sess, (err, res) => {
    t.assert(!err);
    t.assert(res);
  });

  s.length((err, count) => t.assert(count === 2));
  s.clear((err, res) => {
    t.assert(!err);
    t.assert(res);
  });
  s.length((err, count) => t.assert(count === 0));
});

test("if session is touched when expires key is present", (t) => {
  const db = new sqlite(dbName, dbOptions);
  const s = new SqliteStore({
    client: db,
  });

  const sid = "123";
  const sess = { cookie: { maxAge: 100 * 1000 }, name: "sample name" };
  s.set(sid, sess, (err, res) => {
    t.assert(!err);
    t.assert(res);
  });

  const newExpires = add(new Date(), { minutes: 1337 }).toISOString();
  const sess2 = { cookie: { expires: newExpires }, name: "sample name" };
  s.touch(sid, sess2, (err, res) => {
    t.assert(!err);
    t.assert(res);
  });

  const res = db.prepare(`SELECT expire FROM sessions WHERE sid = ?`).get(sid);
  t.assert(new Date(res.expire).toISOString() === newExpires);
});

test("if an inactive session is ignored when touching", async (t) => {
  const db = new sqlite(dbName, dbOptions);
  const s = new SqliteStore({
    client: db,
  });

  const sid = "123";
  const sess = { cookie: { maxAge: 1 * 1000 }, name: "sample name" };
  s.set(sid, sess, (err, res) => {
    t.assert(!err);
    t.assert(res);
  });

  // NOTE: Wait 2 sec to make sure that session is expired.
  await new Promise((resolve) => setTimeout(resolve, 2000));

  const newExpires = add(new Date(), { seconds: 1337 }).toISOString();
  const sess2 = { cookie: { expires: newExpires }, name: "sample name" };
  s.touch(sid, sess2, (err, res) => {
    t.assert(!err);
    t.assert(res);
  });

  const res = db.prepare(`SELECT expire FROM sessions WHERE sid = ?`).get(sid);
  t.assert(differenceInSeconds(new Date(), new Date(res.expire)) < 5);
});

test("that if `expires` is omitted from cookie, a default TTL is used", (t) => {
  const db = new sqlite(dbName, dbOptions);
  const s = new SqliteStore({
    client: db,
  });

  const sid = "123";
  const sess = { cookie: { maxAge: 100 * 1000 }, name: "sample name" };
  s.set(sid, sess, (err, res) => {
    t.assert(!err);
    t.assert(res);
  });

  const newExpires = add(new Date(), { minutes: 1337 }).toISOString();
  const sess2 = { cookie: {}, name: "sample name" };
  s.touch(sid, sess2, (err, res) => {
    t.assert(!err);
    t.assert(res);
  });

  const res = db.prepare(`SELECT expire FROM sessions WHERE sid = ?`).get(sid);
  t.assert(
    Math.abs(
      differenceInSeconds(
        new Date(res.expire),
        add(new Date(), { seconds: 86400 })
      ) < 5
    )
  );
});

test("if an expired session is deleted by continously deleting expired sessions", async (t) => {
  const db = new sqlite(dbName, dbOptions);
  const s = new SqliteStore({
    client: db,
    expired: {
      clear: true,
      intervalMs: 3000,
    },
  });

  const sid = "123";
  // NOTE: Session expires immediately with maxAge being 1 second.
  const sess = { cookie: { maxAge: 1 * 1000 }, name: "instant expire" };
  s.set(sid, sess, (err, res) => {
    t.assert(!err);
    t.assert(res);
  });

  const sid2 = "456";
  const sess2 = { cookie: { maxAge: 100 * 1000 }, name: "long expire" };
  s.set(sid2, sess2, (err, res) => {
    t.assert(!err);
    t.assert(res);
  });

  // NOTE: Wait to make sure that first session is expired.
  await new Promise((resolve) => setTimeout(resolve, 4000));

  s.get(sid, (err, res) => {
    t.assert(!err);
    t.assert(res === null);
  });
  s.get(sid2, (err, res) => {
    t.assert(!err);
    t.deepEqual(sess2, res);
  });
});

test("what happens when table is deleted and all methods are invoked (they should throw)", (t) => {
  const db = new sqlite(dbName, dbOptions);
  const s = new SqliteStore({
    client: db,
    expired: {
      clear: true,
      intervalMs: 3000,
    },
  });
  db.prepare("DROP table sessions").run();

  const sid = "123";
  // NOTE: Session expires immediately with maxAge being 1 second.
  const sess = { cookie: { maxAge: 1 }, name: "instant expire" };
  s.set(sid, sess, (err, res) => t.assert(err));
  s.get(sid, (err, res) => t.assert(err));
  s.touch(sid, null, (err, res) => t.assert(err));
  s.clear((err, res) => t.assert(err));
  s.length((err, res) => t.assert(err));
  s.destroy(sid, (err, res) => t.assert(err));
});

function getSymbolValue(obj, symbol) {
  const refedSymbol = Object.getOwnPropertySymbols(obj).find(
    (s) => s.toString() === symbol
  );
  return obj[refedSymbol];
}

test("if the expiration interval continues being referenced", async (t) => {
  const timeoutMs = 555;
  let loggedResource;

  function init(asyncId, type, triggerAsyncId, resource) {
    if (type === "Timeout" && resource._idleTimeout === timeoutMs) {
      loggedResource = resource;
      t.assert(getSymbolValue(loggedResource, "Symbol(refed)"));
    }
  }
  const asyncHook = async_hooks.createHook({
    init,
  });
  asyncHook.enable();

  const db = new sqlite(dbName, dbOptions);
  const s = new SqliteStore({
    client: db,
    expired: {
      clear: true,
      intervalMs: timeoutMs,
    },
  });

  t.assert(getSymbolValue(loggedResource, "Symbol(refed)"));
});

test("if the expiration interval is going to be unreferenced", async (t) => {
  const timeoutMs = 555;
  let loggedResource;

  function init(asyncId, type, triggerAsyncId, resource) {
    if (type === "Timeout" && resource._idleTimeout === timeoutMs) {
      loggedResource = resource;
      t.assert(getSymbolValue(loggedResource, "Symbol(refed)"));
    }
  }
  const asyncHook = async_hooks.createHook({
    init,
  });
  asyncHook.enable();

  const db = new sqlite(dbName, dbOptions);
  const s = new SqliteStore({
    client: db,
    expired: {
      clear: true,
      intervalMs: timeoutMs,
      unrefInterval: true,
    },
  });

  t.assert(!getSymbolValue(loggedResource, "Symbol(refed)"));
});
