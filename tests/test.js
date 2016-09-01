var DataSource = require('loopback-datasource-juggler').DataSource;
var DB2 = require('loopback-connector-db2i');

var config = {
  username: "acl",
  password: "cordoba",
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
 User.find({ where: { name: 'Gunnar' }}, function(err, users) {
    console.log(err, users);
  });

  User.create({
    id: 12,
    name: 'Tsadasdasdasdoasdasdny',
    email: 'tony@t.com',
    SALARY: 12,
    PERCENT: 11.7666,
  }, function(err, user) {
    console.log(err, user);
  });
 

 User.upsert({
  id: 2,
})

 
