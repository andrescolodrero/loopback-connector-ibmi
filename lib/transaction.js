// Copyright IBM Corp. 2016. All Rights Reserved.
// Node module: loopback-connector-db2
// This file is licensed under the Artistic License 2.0.
// License text available at https://opensource.org/licenses/Artistic-2.0

var debug = require('debug')('loopback:connector:db2i:transaction');
var Transaction = require('loopback-connector').Transaction;
var db = require('/QOpenSys/QIBM/ProdData/Node/os400/db2i/lib/db2');

module.exports = mixinTransaction;

/*!
 * @param {DB2} DB2 connector class
 */
function mixinTransaction(DB2, db2) {

  /**
   * Begin a new transaction

   * @param {Integer} isolationLevel
   * @param {Function} cb
   */
  DB2.prototype.beginTransaction = function(isolationLevel, cb) {
    debug('Begin a transaction with isolation level: %s', isolationLevel);

    if (isolationLevel !== Transaction.READ_COMMITTED &&
      isolationLevel !== Transaction.SERIALIZABLE) {
      var err = new Error('Invalid isolationLevel: ' + isolationLevel);
      err.statusCode = 400;
      return process.nextTick(function() {
        cb(err);
      });
    }

    try {
      db.exec('SET TRANSACTION ISOLATION ' + isolationLevel);
      cb();
    } catch (err) {
      cb(err);
    }
  };

  /**
   * Commit a transaction
   *
   * @param {Object} connection
   * @param {Function} cb
   */
  DB2.prototype.commit = function(connection, cb) {
    debug('Commit a transaction');
    try {
      db.commit();
    } catch (err) {
      return cb(err);
    }
    db.autoCommit(true);
  };

  /**
   * Roll back a transaction
   *
   * @param {Object} connection
   * @param {Function} cb
   */
  DB2.prototype.rollback = function(connection, cb) {
    debug('Rollback a transaction');
    try {
      db.rollback();
    } catch (err) {
      return cb(err);
    }
    db.autoCommit(true);
  };
}
