// Copyright IBM Corp. 2016. All Rights Reserved.
// Node module: loopback-connector-db2
// This file is licensed under the Artistic License 2.0.
// License text available at https://opensource.org/licenses/Artistic-2.0

/*!
 * DB2 connector for LoopBack
 */
var SqlConnector = require('loopback-connector').SqlConnector;
var ParameterizedSQL = SqlConnector.ParameterizedSQL;
//dev
var db = require('/QOpenSys/QIBM/ProdData/OPS/Node4/os400/db2i/lib/db2');
var util = require('util');
var debug = require('debug')('loopback:connector:db2i');
var async = require('async');
var Transaction = require('loopback-connector').Transaction;

// db2i Synchronous settings
db.init(function() {
  // enable debug for development
  db.debug(true);
  db.serverMode(true);
 
  // Naming, Use SQL Convention
  db.setEnvAttr(db.SQL_ATTR_SYS_NAMING, db.SQL_TRUE);

  // UTF-8
  db.setEnvAttr(db.SQL_ATTR_UTF8, db.SQL_TRUE);

  // Remove AutoCommit for typical databases. Not Working, so i will add WITH NONE to sql statements
 // db.autoCommit(false)
});

/**
 * Initialize the DB2i connector for the given data source
 *
 * @param {DataSource} ds The data source instance
 * @param {Function} [cb] The cb function
 */
exports.initialize = function(ds, cb) {
  ds.connector = new DB2i(ds.settings);
  ds.connector.dataSource = ds;
  if (cb) {
    if (ds.settings.lazyConnect) {
      process.nextTick(function() {
        cb();
      });
    } else {
      ds.connector.connect(cb);
    }
  }
};

/**
 * The constructor for the DB2 LoopBack connector
 *
 * @param {Object} settings The settings object
 * @constructor
 */
function DB2i(settings) {
  debug('DB2 constructor settings: %j', settings);
  SqlConnector.call(this, 'db2', settings);
  this.useLimitOffset = settings.useLimitOffset || false;
  this.dbname = (settings.database || settings.db || '*LOCAL');
  this.username = (settings.username ||
                    settings.user);
  this.password = settings.password;
  this.naming = settings.naming || 'sql';

  // The schema is username by default
  this.schema = this.username;
  if (settings.schema) {
    this.schema = settings.schema.toUpperCase();
  }

  // This is less than ideal, better idea would be
  // to extend the propagation of the filter object
  // to executeSQL or pass the options obj around
  this.limitRE = /LIMIT (\d+)/;
  this.offsetRE = /OFFSET (\d+)/;

  // TODO
  // Configure connection
  // db.init(function() {
  //   db.serverMode(true);
  //
  //   // Naming
  //   db.setEnvAttr(db.SQL_ATTR_SYS_NAMING,
  //     (this.naming === 'system' ? db.SQL_TRUE : db.SQL_FALSE));
  //
  //   // UTF-8
  //   db.setEnvAttr(db.SQL_ATTR_UTF8, db.SQL_TRUE);
  // });
}

util.inherits(DB2i, SqlConnector);

function testConnection(cb) {
  var sql = 'SELECT COUNT(*) AS COUNT FROM sysibm.tables';
  db.exec(sql, function(rows) {
    if (rows.length > 0 && rows[0]['COUNT'] > 0) {
      cb && cb();
    } else {
      cb && cb(Error('Failed to use connection'));
    }
  });
};

DB2i.prototype.ping = function(cb) {
  var self = this;

  if (self.dataSource.connected) {
    testConnection(cb);
  } else {
    self.connect(function(err, conn) {
      if (err) {
        cb && cb(Error(err));
      } else if (!testConnection(conn)) {
        cb && cb(Error('Failed to use connection'));
      } else {
        cb && cb();
      }
    });
  }

  return;
};

DB2i.prototype.tableEscaped = function(model) {
  var escapedName = this.escapeName(this.table(model));
  return escapedName;
};

/**
 * Connect to DB2
 *
 * {Function} [cb] The callback after the connect
 */
DB2i.prototype.connect = function(cb) {
  var self = this;

  debug('DB2i.prototype.connect (%s) username=%s',
    self.dbname, self.username);

  // Share connection configuration
  var configureConnection = function() {

    self.connection = db;
    self.dataSource.connected = true;
    self.dataSource.connecting = false;
    self.dataSource.emit('connected');
    cb && cb();
  };

  self.dataSource.connecting = true;
  try {
    if (self.username && self.password) {
      db.conn(self.dbname, self.username, self.password, configureConnection);
    } else {
      db.conn(self.dbname, configureConnection);
    }

    // Set default schema
    if (self.naming === 'sql') {
      db.exec('SET SCHEMA ' + self.schema);
    }
  } catch (err) {
    self.dataSource.connected = false;
    self.dataSource.connecting = false;
    cb && cb(err);
  }
};

function escapeParam(param) {
  if (typeof param === 'string') {
    param = '\'' + param.replace('\'', '\'\'') + '\'';
  }
  return param;
}

/**
 * Execute the sql statement
 *
 */
DB2i.prototype.executeSQL = function(sql, params, options, cb) {
  debug('DB2i.prototype.executeSQL (enter) sql=%j params=%j options=%j',
        sql, params, options);
  var self = this;

  var limit = 0;
  var offset = 0;
  // This is standard DB2 syntax. LIMIT and OFFSET
  // are configured off by default. Enable these to
  // leverage LIMIT and OFFSET.
  if (!this.useLimitOffset) {
    var res = sql.match(self.limitRE);
    if (res) {
      limit = Number(res[1]);
      sql = sql.replace(self.limitRE, '');
    }
    res = sql.match(this.offsetRE);
    if (res) {
      offset = Number(res[1]);
      sql = sql.replace(self.offsetRE, '');
    }
  }

  // Bind parameters manually to monkey patch a driver bug
  var regex = /\?(?=([^']*'[^']*')*[^']*$)/;
  params.forEach(function(param) {
    if (sql.match(regex)) {
      sql = sql.replace(regex, escapeParam(param));
    } else {
      cb && cb(Error('Number of host variables not valid.'));
      return;
    }
  });

  try {
    db.exec(sql, function(data) {
      debug('DB2i.prototype.executeSQL (exit)' +
            ' data=%j', data);

      // Manual limit and offset if there is not supported
      if (offset || limit) {
        data = data.slice(offset, offset + limit);
      }

      // Schedule callback to cleanup the current query
      process.nextTick(function() {
        cb && cb(undefined, data);
      });
    });

    // Better implementation but causes a driver bug
    /* db.prepare(sql);

    // Bind parameters with IBM i conventions
    var bindParams = params.map(function(param) {
      var type;
      switch(typeof param) {
        case 'string':
          type=1
          break;
        case 'number':
          type=2
          break;
        default:
          type=3
      }
      return [param, db.SQL_PARAM_INPUT, type];
    });
    db.bindParam(bindParams);

    db.execute();
    var returnCode;
    var data = [];
    do {
      returnCode = db.fetch(function(row) {
        data.push(row);
      });
    } while(returnCode != db.SQL_NO_DATA_FOUND);
    db.closeCursor();

    debug('DB2i.prototype.executeSQL (exit)' +
          ' params=%j data=%j', params, data);

    // Schedule callback to cleanup the current query
    process.nextTick(function() {
      return cb && cb(undefined, data);
    }); */
  } catch (err) {
    cb && cb(err);
  }
};

/**
 * Escape an identifier such as the column name
 * DB2 requires double quotes for case-sensitivity
 *
 * @param {string} name A database identifier
 * @returns {string} The escaped database identifier
 */
DB2i.prototype.escapeName = function(name) {
  debug('DB2i.prototype.escapeName name=%j', name);
  if (!name) return name;
  name.replace(/["]/g, '""');
  return '"' + name + '"';
};

function dateToDB2(val) {
  var dateStr = val.getFullYear() + '-'
      + fillZeros(val.getMonth() + 1) + '-'
      + fillZeros(val.getDate()) + '-'
      + fillZeros(val.getHours()) + '.'
      + fillZeros(val.getMinutes()) + '.'
      + fillZeros(val.getSeconds()) + '.';
  var ms = val.getMilliseconds();
  if (ms < 10) {
    ms = '00000' + ms;
  } else if (ms < 100) {
    ms = '0000' + ms;
  } else {
    ms = '000' + ms;
  }
  return dateStr + ms;
  function fillZeros(v) {
    return v < 10 ? '0' + v : v;
  }
}

/**
 * Convert property name/value to an escaped DB column value
 *
 * @param {Object} prop Property descriptor
 * @param {*} val Property value
 * @returns {*} The escaped value of DB column
 */
DB2i.prototype.toColumnValue = function(prop, val) {
  debug('DB2i.prototype.toColumnValue prop=%j val=%j', prop, val);
  if (val === null) {
    if (prop.autoIncrement || prop.id) {
      return new ParameterizedSQL('DEFAULT');
    }
    return null;
  }
  if (!prop) {
    return val;
  }
  switch (prop.type.name) {
    default:
    case 'Array':
    case 'Number':
    case 'String':
      return val;
    case 'Boolean':
      return Number(val);
    case 'Object':
    case 'ModelConstructor':
      return JSON.stringify(val);
    case 'JSON':
      return String(val);
    case 'Date':
      return dateToDB2(val);
  }
};

/*!
 * Convert the data from database column to model property
 *
 * @param {object} Model property descriptor
 * @param {*) val Column value
 * @returns {*} Model property value
 */
DB2i.prototype.fromColumnValue = function(prop, val) {
  debug('DB2i.prototype.fromColumnValue %j %j', prop, val);
  if (val === null || !prop) {
    return val;
  }
  switch (prop.type.name) {
    case 'Number':
      return Number(val);
    case 'String':
      return String(val);
    case 'Date':
      return new Date(val);
    case 'Boolean':
      return Boolean(val);
    case 'GeoPoint':
    case 'Point':
    case 'List':
    case 'Array':
    case 'Object':
    case 'JSON':
      return JSON.parse(val);
    default:
      return val;
  }
};

/**
 * Get the place holder in SQL for identifiers, such as ??
 *
 * @param {string} key Optional key, such as 1 or id
 */
DB2i.prototype.getPlaceholderForIdentifier = function(key) {
  throw new Error('Placeholder for identifiers is not supported: ' + key);
};

/**
 * Get the place holder in SQL for values, such as :1 or ?
 *
 * @param {string} key Optional key, such as 1 or id
 * @returns {string} The place holder
 */
DB2i.prototype.getPlaceholderForValue = function(key) {
  debug('DB2i.prototype.getPlaceholderForValue key=%j', key);
  return '(?)';
};


/**
 * Build the clause for default values if the fields is empty
 *
 * @param {string} model The model name
 * @returns {string} default values statement
 */
DB2i.prototype.buildInsertDefaultValues = function(model) {
  var def = this.getModelDefinition(model);
  var num = Object.keys(def.properties).length;
  var result = '';
  if (num > 0) result = 'DEFAULT';
  for (var i = 1; i < num && num > 1; i++) {
    result = result.concat(',DEFAULT');
  }
  return 'VALUES(' + result + ')';
};

/**
 * Create the table for the given model
 *
 * @param {string} model The model name
 * @param {Function} [cb] The callback function
 */
DB2i.prototype.createTable = function(model, cb) {
  debug('DB2i.prototype.createTable ', model);
  var self = this;
  var tableName = self.tableEscaped(model);
  var tableSchema = self.schema;
  var columnDefinitions = self.buildColumnDefinitions(model);
  var tasks = [];

  tasks.push(function(cb) {
    var sql = 'CREATE TABLE ' + tableSchema + '.' + tableName +
        ' (' + columnDefinitions + ');';
    self.execute(sql, cb);
  });

  var indexes = self.buildIndexes(model);
  indexes.forEach(function(i) {
    tasks.push(function(cb) {
      self.execute(i, cb);
    });
  });

  async.series(tasks, cb);
};

/**
 * Create the data model in DB2
 *
 * @param {string} model The model name
 * @param {Object} data The model instance data
 * @param {Object} options Options object
 * @param {Function} [cb] The callback function
 */
DB2i.prototype.create = function(model, data, options, cb) {
  var self = this;
  var stmt = self.buildInsert(model, data, options);
  var id = self.idName(model);
  var sql = 'SELECT \"' + id + '\" FROM FINAL TABLE (' + stmt.sql + ') with none';
 
  self.execute(sql, stmt.params, options, function(err, info) {
    if (err) {
      cb(err);
    } else {
      cb(err, info[0][id]);
    }
  });
};

/**
 * Update all instances that match the where clause with the given data
 *
 * @param {string} model The model name
 * @param {Object} where The where object
 * @param {Object} data The property/value object representing changes
 * to be made
 * @param {Object} options The options object
 * @param {Function} cb The callback function
 */
DB2i.prototype.update = function(model, where, data, options, cb) {
  
  var self = this;
  var stmt = self.buildUpdate(model, where, data, options);
  var id = self.idName(model);
  var sql = 'SELECT \"' + id + '\" FROM FINAL TABLE (' + stmt.sql + ') with none';
  self.execute(sql, stmt.params, options, function(err, info) {
    if (cb) {
      cb(err, {count: info.length});
    }
  });
};

/**
 * Update if the model instance exists with the same id or create a new instance
 *
 * @param {string} model The model name
 * @param {Object} data The model instance data
 * @param {Function} [callback] The callback function
 */
DB2i.prototype.updateOrCreate = DB2i.prototype.save =
  function(model, data, options, cb) {
    var self = this;
    var id = self.idName(model);
    var stmt;
    var tableName = self.tableEscaped(model);
    var meta = {};

    function executeWithConnection(connection, cb) {
      // Execution for updateOrCreate requires running two
      // separate SQL statements.  The second depends on the
      // result of the first.
      var countStmt = new ParameterizedSQL('SELECT COUNT(*) AS CNT FROM ');
      countStmt.merge(tableName);
      countStmt.merge(self.buildWhere(data));

      connection.query(countStmt.sql, countStmt.params,
        function(err, countData) {
          if (err) {
            return cb(err);
          }

          if (countData[0]['CNT'] > 0) {
            stmt = self.buildUpdate(model, data.id, data);
          } else {
            stmt = self.buildInsert(model, data);
          }

          connection.query(stmt.sql, stmt.params, function(err, sData) {
            if (err) {
              return cb(err);
            }

            if (countData[0]['CNT'] > 0) {
              meta.isNewInstance = false;
              cb(null, data, meta);
            } else {
              stmt = 'SELECT MAX(' + id + ') as id FROM ' + tableName;
              connection.query(stmt, null, function(err, info) {
                if (err) {
                  return cb(err);
                }
                data.id = info[0]['CNT'];
                cb(null, data, meta);
              });
            }
          });
        });
    };

    if (options.transaction) {
      executeWithConnection(options.transaction.connection,
        function(err, data, meta) {
          if (err) {
            return cb && cb(err);
          } else {
            return cb && cb(null, data, meta);
          }
        });
    } else {
      self.beginTransaction(Transaction.READ_COMMITTED, function(err, conn) {
        // self.client.open(self.connStr, function(err, conn) {
        if (err) {
          return cb && cb(err);
        }

        // conn.beginTransaction(function(err) {
        if (err) {
          return cb && cb(err);
        }

        executeWithConnection(conn, function(err, data, meta) {
          if (err) {
            conn.rollbackTransaction(function(err) {
              conn.close(function() {});
              return cb && cb(err);
            });
          } else {
            options.transaction = undefined;
            conn.commitTransaction(function(err) {
              if (err) {
                return cb && cb(err);
              }

              conn.close(function() {});
              return cb && cb(null, data, meta);
            });
          }
        });
        // });
      });
    }
  };

/**
 * Delete all matching model instances
 *
 * @param {string} model The model name
 * @param {Object} where The where object
 * @param {Object} options The options object
 * @param {Function} cb The callback function
 */
DB2i.prototype.destroyAll = function(model, where, options, cb) {
  var self = this;
  var tableName = self.tableEscaped(model);
  var deleteStmt = self.buildDelete(model, where, options);
  var selectStmt = new ParameterizedSQL('SELECT COUNT(*)');

  process.nextTick(function() {

    selectStmt.merge('AS count FROM ' + tableName);
    selectStmt.merge(self.buildWhere(model, where));

    self.executeSQL(selectStmt.sql, selectStmt.params, {}, function(err, rows) {
      if (err) {
        return cb(err);
      }

      self.executeSQL(deleteStmt, [], {}, function(err) {
        cb(err, {count: rows[0]['count']});
      });
    });
  });
};

function buildLimit(limit, offset) {
  if (isNaN(limit)) { limit = 0; }
  if (isNaN(offset)) { offset = 0; }
  if (!limit && !offset) {
    return '';
  }
  if (limit && !offset) {
    return 'FETCH FIRST ' + limit + ' ROWS ONLY';
  }
  if (offset && !limit) {
    return 'OFFSET ' + offset;
  }
  return 'LIMIT ' + limit + ' OFFSET ' + offset;
}

DB2i.prototype.applyPagination = function(model, stmt, filter) {
  debug('DB2i.prototype.applyPagination');
  var limitClause = buildLimit(filter.limit, filter.offset || filter.skip);
  return stmt.merge(limitClause);
};


DB2i.prototype.getCountForAffectedRows = function(model, info) {
  var affectedRows = info && typeof info.affectedRows === 'number' ?
      info.affectedRows : undefined;
  return affectedRows;
};

/**
 * Drop the table for the given model from the database
 *
 * @param {string} model The model name
 * @param {Function} [cb] The callback function
 */
DB2i.prototype.dropTable = function(model, cb) {
  var self = this;
  var dropStmt = 'DROP TABLE ' + self.schema + '.' +
    self.tableEscaped(model);

  self.execute(dropStmt, null, null, function(err, countData) {
    if (err) {
      if (!err.toString().includes('42704')) {
        return cb && cb(err);
      }
    }
    return cb && cb(err);
  });
};

DB2i.prototype.buildColumnDefinitions = function(model) {
  var self = this;
  var sql = [];
  var definition = this.getModelDefinition(model);
  var pks = this.idNames(model).map(function(i) {
    return self.columnEscaped(model, i);
  });
  Object.keys(definition.properties).forEach(function(prop) {
    var colName = self.columnEscaped(model, prop);
    sql.push(colName + ' ' + self.buildColumnDefinition(model, prop));
  });
  if (pks.length > 0) {
    sql.push('PRIMARY KEY(' + pks.join(',') + ')');
  }

  return sql.join(',\n');
};

DB2i.prototype.buildIndex = function(model, property) {
  debug('DB2i.prototype.buildIndex %j %j', model, property);
  var self = this;
  // var prop = self.getModelDefinition(model).properties[property];
  var prop = self.getPropertyDefinition(model, property);
  var i = prop && prop.index;
  if (!i) {
    return '';
  }

  var stmt = 'CREATE ';
  var kind = '';
  if (i.kind) {
    kind = i.kind;
  }
  var columnName = self.columnEscaped(model, property);
  if (typeof i === 'object' && i.unique && i.unique === true) {
    kind = 'UNIQUE';
  }
  return (stmt + kind + ' INDEX ' + columnName +
          ' ON ' + self.schema + '.' + self.tableEscaped(model) +
          ' (' + columnName + ');\n');
};

DB2i.prototype.buildIndexes = function(model) {
  debug('DB2i.prototype.buildIndexes %j', model);

  var self = this;
  var indexClauses = [];
  var definition = this.getModelDefinition(model);
  var indexes = definition.settings.indexes || {};
  // Build model level indexes
  for (var index in indexes) {
    var i = indexes[index];
    var stmt = 'CREATE ';
    var kind = '';
    if (i.kind) {
      kind = i.kind;
    }
    var indexedColumns = [];
    var indexName = this.escapeName(index);
    if (Array.isArray(i.keys)) {
      indexedColumns = i.keys.map(function(key) {
        return self.columnEscaped(model, key);
      });
    }

    var columns = (i.columns.split(/,\s*/)).join('\",\"');
    if (indexedColumns.length > 0) {
      columns = indexedColumns.join('\",\"');
    }

    indexClauses.push(stmt + kind + ' INDEX ' + indexName +
                      ' ON ' + this.schema + '.' + this.tableEscaped(model) +
                      ' (\"' + columns + '\");\n');
  }

  // Define index for each of the properties
  // for (var p in definition.properties) {
  //   var propIndex = this.buildIndex(model, p);
  //   if (propIndex) {
  //     indexClauses.push(propIndex);
  //   }
  // }

  return indexClauses;
};

DB2i.prototype.buildColumnDefinition = function(model, prop) {
  // var p = this.getModelDefinition(model).properties[prop];
  var p = this.getPropertyDefinition(model, prop);
  if (p.id && p.generated) {
    return 'INT NOT NULL GENERATED BY DEFAULT' +
      ' AS IDENTITY (START WITH 1 INCREMENT BY 1)';
  }
  var line = this.columnDataType(model, prop) + ' ' +
      (this.isNullable(p) ? '' : 'NOT NULL');
  return line;
};

DB2i.prototype.columnDataType = function(model, property) {
  var prop = this.getPropertyDefinition(model, property);
  if (!prop) {
    return null;
  }
  return this.buildColumnType(prop);
};

DB2i.prototype.buildColumnType = function buildColumnType(propertyDefinition) {
  var self = this;
  var dt = '';
  var p = propertyDefinition;
  var type = p.type.name;

  switch (type) {
    default:
    case 'Any':
    case 'Text':
    case 'String':
      dt = self.convertTextType(p, 'VARCHAR');
      break;
    case 'Number':
      dt = self.convertNumberType(p, 'INTEGER');
      break;
    case 'Date':
      dt = 'TIMESTAMP';
      break;
    case 'Boolean':
      dt = 'SMALLINT';
      break;
   case 'Decimal':
   dt = self.convertNumberType(p, 'INTEGER');
      break;
  }
  debug('DB2i.prototype.buildColumnType %j %j', p.type.name, dt);
  return dt;
};

DB2i.prototype.convertTextType = function convertTextType(p, defaultType) {
  var self = this;
  var dt = defaultType;
  var len = p.length ||
    ((p.type !== String) ? 4096 : p.id ? 255 : 512);

  if (p[self.name]) {
    if (p[self.name].dataLength) {
      len = p[self.name].dataLength;
    }
  }

  if (p[self.name] && p[self.name].dataType) {
    dt = String(p[self.name].dataType);
  } else if (p.dataType) {
    dt = String(p.dataType);
  }

  dt += '(' + len + ')';

  stringOptions(p, dt);

  return dt;
};

DB2i.prototype.convertNumberType = function convertNumberType(p, defaultType) {
  var self = this;
  var dt = defaultType;
  var precision = p.precision;
  var scale = p.scale;

  if (p[self.name] && p[self.name].dataType) {
    dt = String(p[self.name].dataType);
    precision = p[self.name].dataPrecision;
    scale = p[self.name].dataScale;
  } else if (p.dataType) {
    dt = String(p.dataType);
  } else {
    return dt;
  }

  switch (dt) {
    case 'DECIMAL':
      dt = 'DECIMAL';
      if (precision && scale) {
        dt += '(' + precision + ',' + scale + ')';
      } else if (scale > 0) {
        throw new Error('Scale without Precision does not make sense');
      }
      break;
    default:
      break;
  }

  return dt;
};

function stringOptions(p, columnType) {
  if (p.charset) {
    columnType += ' CHARACTER SET ' + p.charset;
  }
  if (p.collation) {
    columnType += ' COLLATE ' + p.collation;
  }
  return columnType;
}

require('./migration')(DB2i);
require('./discovery')(DB2i);
//require('./transaction')(DB2i);


