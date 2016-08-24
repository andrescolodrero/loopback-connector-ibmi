// Copyright IBM Corp. 2016. All Rights Reserved.
// Node module: loopback-connector-db2
// This file is licensed under the Artistic License 2.0.
// License text available at https://opensource.org/licenses/Artistic-2.0

module.exports = mixinDiscovery;

/**
* @param {DB2} DB2 connector class
* @param {Object} db2
*/
function mixinDiscovery(DB2, db2) {
  var async = require('async');

  function paginateSQL(sql, orderBy, options) {
    options = options || {};
    var limitClause = '';
    if (options.offset || options.skip || options.limit) {
      // Offset starts from 0
      var offset = Number(options.offset || options.skip || 0);
      if (isNaN(offset)) {
        offset = 0;
      }
      if (options.limit) {
        var limit = Number(options.limit);
        if (isNaN(limit)) {
          limit = 0;
        }
        limitClause = ' FETCH FIRST ' + limit + ' ROWS ONLY';
      }
    }
    if (!orderBy) {
      sql += ' ORDER BY ' + orderBy;
    }

    // return sql + limitClause;
    return sql + limitClause;
  }

  /**
   * Build sql for listing schemas (databases in DB2)
   *
   * @param {Object} [options]
   * @returns {string} sql
   */
  function querySchemas(options) {
    var sql = 'SELECT table_cat AS "catalog",' +
      ' table_schem AS "schema"' +
      ' FROM sysibm.sqlschemas';

    return paginateSQL(sql, 'table_schem', options);
  }

  /**
   * Build sql for listing tables
   *
   * @param {Object} options
   * @returns {string} sql
   */
  function queryTables(options) {
    var sqlTables = null;
    var schema = options.owner || options.schema;

    if (options.all && !schema) {
      sqlTables = paginateSQL('SELECT \'table\' AS "type",' +
        ' table_name AS "name", table_schem AS "owner"' +
        ' FROM sysibm.sqltables WHERE table_type = \'TABLE\'',
        ' table_schem', 'table_name', options);
    } else if (schema) {
      sqlTables = paginateSQL('SELECT \'table\' AS "type",' +
        ' table_name AS "name", table_schem AS "owner"' +
        ' FROM sysibm.sqltables WHERE table_schem = \'' + schema + '\'' +
        ' AND table_type = \'TABLE\'',
        ' table_schem', 'table_name', options);
    } else {
      sqlTables = paginateSQL('SELECT \'table\' AS "type",' +
        ' table_name AS "name", table_schem AS "owner"' +
        ' FROM sysibm.sqltables WHERE table_schem = USER' +
        ' AND table_type = \'TABLE\'',
        ' table_schem', 'table_name', options);
    }

    return sqlTables;
  }

  /**
   * Build sql for listing views
   *
   * @param {Object} options
   * @returns {string} sql
   */
  function queryViews(options) {
    var sqlViews = null;
    if (options.views) {

      var schema = options.owner || options.schema;

      if (options.all && !schema) {
        sqlViews = paginateSQL('SELECT \'view\' AS "type",' +
          ' table_name AS "name",' +
          ' table_schem AS "owner"' +
          ' FROM sysibm.sqltables' +
          ' WHERE table_type = \'VIEW\'',
          'table_schem, table_name', options);
      } else if (schema) {
        sqlViews = paginateSQL('SELECT \'view\' AS "type",' +
          ' table_name AS "name",' +
          ' table_schem AS "owner"' +
          ' FROM sysibm.sqltables' +
          ' WHERE table_type = \'VIEW\' AND table_schem=\'' + schema + '\'',
          'table_schem, table_name', options);
      } else {
        sqlViews = paginateSQL('SELECT \'view\' AS "type",' +
          ' table_name AS "name",' +
          ' table_schem AS "owner"' +
          ' FROM sysibm.sqltables' +
          ' WHERE table_schem = USER' +
          ' AND table_type = \'VIEW\'',
          'table_name', options);
      }
    }

    return sqlViews;
  }

  /**
   * Discover database schemas
   *
   // * @param {Object} options Options for discovery
   * @param {Function} [cb] The callback function
   */
  DB2.prototype.discoverDatabaseSchemas = function(cb) {
    var options = {};

    this.execute(querySchemas(options), cb);
  };

  /**
   * Discover model definitions
   *
   * @param {Object} options Options for discovery
   * @param {Function} [cb] The callback function
   */
  DB2.prototype.discoverModelDefinitions = function(options, cb) {
    var self = this;
    if (!cb && typeof options === 'function') {
      cb = options;
      options = {};
    }
    options = options || {};

    var calls = [function(callback) {
      self.execute(queryTables(options), callback);
    }];

    if (options.views) {
      calls.push(function(callback) {
        self.execute(queryViews(options), callback);
      });
    }
    async.parallel(calls, function(err, data) {
      if (err) {
        cb(err, data);
      } else {
        var merged = [];
        merged = merged.concat(data.shift());
        if (data.length) {
          merged = merged.concat(data.shift());
        }
        cb(err, merged);
      }
    });
  };

  /**
   * Normalize the arguments
   *
   * @param {string} table
   * @param {Object} [options]
   * @param {Function} [cb]
   */
  function getArgs(table, options, cb) {
    // if ('string' !== (typeof table || !table)) {
    //   throw new Error('table is a required string argument: ' + table);
    // }
    options = options || {};
    // if (!cb && 'function' === (typeof options)) {
    //   cb = options;
    //   options = {};
    // }
    if (typeof options !== 'object') {
      throw new Error('options must be an object: ' + options);
    }

    return {
      schema: options.owner || options.schema,
      table: table,
      options: options,
      cb: cb,
    };
  }

  /**
   * Build the sql statement to query columns for a given table
   *
   * @param {string} schema
   * @param {string} table
   * @returns {string} The sql statement
   */
  function queryColumns(schema, table) {
    var sql = null;
    if (schema) {
      sql = paginateSQL('SELECT table_schem AS "owner",' +
        ' table_name AS "tableName",' +
        ' column_name AS "columnName",' +
        ' type_name AS "dataType",' +
        ' buffer_length AS "dataLength",' +
        ' num_prec_radix AS "dataPrecision",' +
        ' decimal_digits AS "dataScale",' +
        ' nullable AS "nullable"' +
        ' FROM sysibm.sqlcolumns' +
        ' WHERE table_schem = \'' + schema + '\'' +
        (table ? ' AND table_name = \'' + table + '\'' : ''),
        'table_name, ordinal_position', {});
    } else {
      sql = paginateSQL('SELECT table_schem AS "owner",' +
        ' table_name AS "tableName",' +
        ' column_name AS "columnName",' +
        ' type_name AS "dataType",' +
        ' buffer_length AS "dataLength",' +
        ' num_prec_radix AS "dataPrecision",' +
        ' decimal_digits AS "dataScale",' +
        ' nullable AS "nullable"' +
        ' FROM sysibm.sqlcolumns' +
        (table ? ' WHERE table_name = \'' + table + '\'' : ''),
        'tabname, ordinal_position', {});
    }

    return sql;
  }

  /**
   * Discover model properties from a table
   *
   * @param {string} table The table name
   * @param {Object} options The options for discovery
   * @param {Function} [cb] The callback function
   *
   */
  DB2.prototype.discoverModelProperties = function(table, options, cb) {
    var self = this;
    var args = getArgs(table, options, cb);
    var schema = args.schema;
    if (!schema) {
      schema = this.getDefaultSchema();
    }
    table = args.table;
    options = args.options;
    cb = args.cb;

    var sql = queryColumns(schema, table);

    var callback = function(err, results) {
      if (err) {
        cb(err, results);
      } else {
        results.map(function(r) {
          r.type = self.buildPropertyType(r);
          r.nullable = r.nullable === '1' ? 'Y' : 'N';
        });
        cb(err, results);
      }
    };

    this.execute(sql, callback);
  };

  /**
   * Build the sql statement for querying primary keys of a given table
   *
   * @param {string} schema
   * @param {string} table
   * @returns {string}
   */
  function queryPrimaryKeys(schema, table) {
    var sql = 'SELECT table_schem AS "owner",' +
      ' table_name AS "tableName",' +
      ' column_name AS "columnName",' +
      ' key_seq AS "keySeq",' +
      ' pk_name AS "pkName"' +
      ' FROM sysibm.sqlprimarykeys';

    if (schema || table) {
      sql += ' WHERE';
      if (schema) {
        sql += ' table_schem = \'' + schema + '\'';
      }
      if (table) {
        if (schema) {
          sql += ' AND';
        }
        sql += ' table_name = \'' + table + '\'';
      }
    }

    sql += ' ORDER BY' +
      ' table_schem, table_name, key_seq';

    return sql;
  }

  /**
   * Discover primary keys for a given table
   *
   * @param {string} table The table name
   * @param {Object} options The options for discovery
   * @param {Function} [cb] The callback function
   */
  DB2.prototype.discoverPrimaryKeys = function(table, options, cb) {
    var args = getArgs(table, options, cb);
    var schema = args.schema;
    if (!schema) {
      schema = this.getDefaultSchema();
    }
    table = args.table;
    options = args.options;
    cb = args.cb;

    var sql = queryPrimaryKeys(schema, table);

    this.execute(sql, cb);
  };

  /**
   * Build the sql statement for querying foreign keys of a given table
   *
   * @param {string} schema
   * @param {string} table
   * @returns {string}
   */
  function queryForeignKeys(schema, table) {
    var sql =
      'SELECT pktable_schem AS "fkOwner",' +
      ' fk_name AS "fkName",' +
      ' fktable_name AS "fkTableName",' +
      ' pktable_schem AS "pkOwner", pk_name AS "pkName",' +
      ' pktable_name AS "pkTableName",' +
      ' fkcolumn_name AS "pkColumnName"' +
      ' FROM sysibm.sqlforeignkeys';

    if (schema || table) {
      sql += ' WHERE';
      if (schema) {
        sql += ' pktable_schem LIKE \'' + schema + '\'';
      }
      if (table) {
        if (schema) {
          sql += ' AND';
        }
        sql += ' pktable_name LIKE \'"' + table + '\'';
      }
    }

    return sql;
  }

  /**
   * Discover foreign keys for a given table
   *
   * @param {string} table The table name
   * @param {Object} options The options for discovery
   * @param {Function} [cb] The callback function
   */
  DB2.prototype.discoverForeignKeys = function(table, options, cb) {
    var args = getArgs(table, options, cb);
    var schema = args.schema;
    if (!schema) {
      schema = this.getDefaultSchema();
    }
    table = args.table;
    options = args.options;
    cb = args.cb;

    var sql = queryForeignKeys(schema, table);
    this.execute(sql, cb);
  };

  /**
   * Retrieves a description of the foreign key columns that reference the
   *
   * given table's primary key columns (the foreign keys exported by a table).
   * They are ordered by fkTableOwner, fkTableName, and keySeq.
   *
   * @param {string} schema
   * @param {string} table
   * @returns {string}
   */
  function queryExportedForeignKeys(schema, table) {
    var sql = 'SELECT a.constraint_name AS "fkName",' +
      ' a.tabschema AS "fkOwner",' +
      ' a.tabname AS "fkTableName",' +
      ' a.colname AS "fkColumnName",' +
      ' NULL AS "pkName",' +
      ' a.referenced_table_schema AS "pkOwner",' +
      ' a.referenced_table_name AS "pkTableName",' +
      ' a.referenced_column_name AS "pkColumnName"' +
      ' FROM information_schema.key_column_usage a' +
      ' WHERE a.position_in_unique_constraint IS NOT NULL';
    if (schema) {
      sql += ' AND a.referenced_table_schema="' + schema + '"';
    }
    if (table) {
      sql += ' AND a.referenced_table_name="' + table + '"';
    }
    sql += ' ORDER BY a.table_schema, a.table_name, a.ordinal_position';

    return sql;
  }

  /**
   * Discover foreign keys that reference to the primary key of this table
   *
   * @param {string} table The table name
   * @param {Object} options The options for discovery
   * @param {Function} [cb] The callback function
   */
  DB2.prototype.discoverExportedForeignKeys = function(table, options, cb) {
    var args = getArgs(table, options, cb);
    var schema = args.schema;
    if (!schema) {
      schema = this.getDefaultSchema();
    }
    table = args.table;
    options = args.options;
    cb = args.cb;

    var sql = queryExportedForeignKeys(schema, table);
    this.execute(sql, cb);
  };

  DB2.prototype.buildPropertyType = function(columnDefinition) {
    var db2Type = columnDefinition.dataType;
    var dataLength = columnDefinition.dataLength;

    var type = db2Type.toUpperCase();
    switch (type) {
      case 'CHAR':
        if (dataLength === 1) {
          // Treat char(1) as boolean
          return 'Boolean';
        } else {
          return 'String';
        }
        break;
      case 'VARCHAR':
      case 'TINYTEXT':
      case 'MEDIUMTEXT':
      case 'LONGTEXT':
      case 'TEXT':
      case 'ENUM':
      case 'SET':
        return 'String';
      case 'TINYBLOB':
      case 'MEDIUMBLOB':
      case 'LONGBLOB':
      case 'BLOB':
      case 'BINARY':
      case 'VARBINARY':
      case 'BIT':
        return 'Binary';
      case 'TINYINT':
      case 'SMALLINT':
      case 'INT':
      case 'INTEGER':
      case 'MEDIUMINT':
      case 'YEAR':
      case 'FLOAT':
      case 'DOUBLE':
      case 'BIGINT':
        return 'Number';
      case 'DATE':
      case 'TIMESTAMP':
      case 'DATETIME':
        return 'Date';
      case 'POINT':
        return 'GeoPoint';
      default:
        return 'String';
    }
  };

  DB2.prototype.getDefaultSchema = function() {
    // LOGNAME is both on IBM i and linux
    // TODO fix that
    return process.env['LOGNAME'];
    // if (this.dataSource && this.dataSource.settings &&
    //   this.dataSource.settings.database) {
    //   return this.dataSource.settings.database;
    // }
    // return undefined;
  };
}
