# lb4-sql-controller

This is a small CLI utility to add query based controllers to a loopback 4 application.

## Installation

Run the following command to install the CLI.

```
$ npm install -g lb4-sql-controller
```

## Prerequisites

- Run the cli in a LoopBack 4 project.
- Run the cli after the models and their repositories are already generated.


## Basic Use

Run `lb4-sql-controller --query 'select * from customers;' --path 'sql-api' --repoName 'customers' --controllerName 'customers'` or `lb4-sql-controller --config '{"query": "select * from customers;", "path": "sql-api", "repoName": "customers", "controllerName": "customers"}'`.

### Options

- query: pass sql query to be executed. Example: select * from customers
- path: uri of this new custom API. Example: sql-api
- repoName: repository name this controller should use to execute the query. Example customers.
- controllerName: name of the controller class and the file. Example: customers

## APIs generated

- generate a new controller class and hence the API to execute the API.

## License

ISC
