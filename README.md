# Work in progress
Lots of work to do, but the connector can be used for get, create and update data from a Model.

I disabled "transaction" ORM feature.


#loopback-connector-ibmi

The `loopback-connector-ibmi` module is the LoopBack connector for DB2 for IBM i based on the project https://github.com/pierrickrouxel/loopback-connector-db2i

The connector ONLY WORKS NATIVE ON IBMi.

The LoopBack IBMi connector supports:

- All [CRUD operations](https://docs.strongloop.com/display/LB/Creating%2C+updating%2C+and+deleting+data).
- [Queries](https://docs.strongloop.com/display/LB/Querying+data) with fields, limit, order, skip and where filters.
- Native Connection.

## Installation

In the loopback application directory:
npm install loopback-connector-ibmi

The `--save` option adds the dependency to the application's `package.json` file.

## Configuration

Use the [data source generator](https://docs.strongloop.com/display/LB/Data+source+generator) (`slc loopback:datasource`) to add the IBMi data source to your application. The Datasource generator doesnt contain "IBMi" conector, but you can create it manual.

The entry in the application's `server/datasources.json` will look something like this:

```
"mydb": {
  "name": "mydb",
  "connector": "ibmi"
}
```

Edit `server/datasources.json` to add other supported properties as required:

```
"mydb": {
  "name": "mydb",
  "connector": "ibmi",
  "username": <username>,
  "password": <password>,
  "database": <database name>,
  "hostname": <db2 server hostname>,
  "port":     <port number>
}
```

The following table describes the connector properties.

Property       | Type    | Description
---------------| --------| --------
database       | String  | Database name
schema         | String  | Specifies the default schema name that is used to qualify unqualified database objects in dynamically prepared SQL statements. The value of this property sets the value in the CURRENT SCHEMA special register on the database server. The schema name is case-sensitive, and must be specified in uppercase characters
username       | String  | IBMi Username
password       | String  | IBMi password associated with the username above
hostname       | String  | IBMi server hostname or IP address


Alternatively, you can create and configure the data source in JavaScript code.
For example:

```
var DataSource = require('loopback-datasource-juggler').DataSource;
var DB2 = require('loopback-connector-db2i');

var config = {
  username: "IBMi USER",
  password: "PASSWORD",
  hostname: "disibic22",
  port: 50000,
  database: 'D205973W',
  schema: 'ACL'
};

var db = new DataSource(DB2, config);


  

var User = db.define('USER', {
  name: { type: String },
  email: { type: String },
  SALARY: {type: Number},
  PERCENT: {type: Number},
});
// Find Existing User
 User.find({ where: { name: 'Gunnar' }}, function(err, users) {
    console.log(err, users);
  });

// Create existing user. ID doesnt need to be created in the model.
  User.create({
    id: 1,
    name: 'Test User',
    email: 'tony@t.com',
    SALARY: 12,
    PERCENT: 11.7666,
  }, function(err, user) {
    console.log(err, user);
  });
 



 
