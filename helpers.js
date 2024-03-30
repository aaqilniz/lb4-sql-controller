const { Parser } = require('node-sql-parser');
const { exec } = require('child_process');
const fs = require('fs');

module.exports.parseQuery = (query) => {
    try {
        const parser = new Parser();
        return parser.astify(query);
    } catch (error) {
        throw Error('failed to parse the query.');
    }
}

module.exports.getTableNames = (query) => {
    const parsedQuery = this.parseQuery(query)[0];
    const names = [];
    parsedQuery.from.forEach(from => { names.push(from.table); });
    return names;
}

module.exports.getProperties = (query) => {
    const parsedQuery = this.parseQuery(query);

    // get paths to deeply nested properties from the query's json object.
    const getPaths = (obj) =>
        Object(obj) === obj
            ? Object.entries(obj).flatMap(([k, v]) => getPaths(v).map(p => [k, ...p]))
            : [[]];

    // access deeply nested object keys
    const nestedObject = (obj) =>
        getPaths(obj)
            .map(p => p.at(-1) == '=' ? p.slice(0, -1) : p)
            .map(p => p.join('.'))

    const obj = parsedQuery[0].where; // read column or property names from where clause
    const keys = nestedObject(obj);
    const columns = {};

    // construct key-value object for all the properties from where clause with their original name
    keys.forEach(key => {
        if (key.includes('.')) {
            const splitedKey = key.split('.');
            let i = 0;
            let temp = obj;
            while (i < splitedKey.length) {
                if (temp) {
                    temp = temp[splitedKey[i]];
                    if (temp?.left?.type === 'column_ref') {
                        if (
                            typeof temp.right?.value === 'string' &&
                            temp.right?.value?.includes('${') //a variable, e.g. ${from_date} 
                        ) {
                            const variable = this.getVariables(temp.right?.value)[0];
                            columns[variable] = temp.left?.column;
                        } else {
                            columns[temp.left?.column] = temp.left?.column;
                        }
                    }
                }
                i++;
            }
        }
    });

    // holding properties from select statement
    const selectedProperties = {};

    const primitiveTypes = ['string', 'number']; //possibly add more

    /* iterate through all columns from select and generate an object 
    with key-values tracing original and AS names */

    parsedQuery[0]?.columns.forEach(column => {
        if (column.as) {
            if (column.expr && column.expr.column) {
                if (primitiveTypes.includes(column.expr.type)) {
                    selectedProperties[column.as] = { key: column.expr?.column, type: column.expr.type };
                } else {
                    selectedProperties[column.as] = { key: column.expr?.column };
                }
            } else if (column.expr && column.expr.args) {
                const { args } = column.expr;
                args.value.forEach(arg => {
                    if (arg.left) {
                        selectedProperties[column.as] = { key: arg.left.column }
                    }
                });
            } else {
                if (primitiveTypes.includes(column.expr.type)) {
                    selectedProperties[column.as] = { key: column.as, type: column.expr.type }
                } else {
                    selectedProperties[column.as] = { key: column.as }
                }
            }
        } else {
            if (column.expr && column.expr.column === '*') { // * means all the properties are supposed to be fetched
                selectedProperties.all = true; // in this case, the properties are being fetched at the cli.
            } else if (column.expr && column.expr.name) {
                /* if the select statement has a column/property with primitive type. e.g. select 40 as week from employees*/
                if (primitiveTypes.includes(column.expr.type)) {
                    selectedProperties[column.expr.name] = { key: column.expr.name, type: column.expr.type };
                } else {
                    selectedProperties[column.expr.name] = { key: column.expr.name };
                }
            } else if (column.expr && column.expr?.column && column.expr?.type === 'column_ref') {
                selectedProperties[column.expr.column] = { key: column.expr.column };
            }
        }
    });
    return { selectedProperties, columns };
}

// extract variables from the query e.g. ${from_date}
module.exports.getVariables = (query) => {
    // Regular expression to match variables inside ${}
    const regex = /\${([^}]+)}/g;
    // Array to store matched variables
    const variables = [];
    // Match all variables in the SQL query
    let match;
    while ((match = regex.exec(query)) !== null) {
        variables.push(match[1]); // Push matched variable (without ${}) to array
    }
    return variables;
}

module.exports.isLoopBackApp = (package) => {
    if (!package) return false;
    const { dependencies } = package;
    if (!dependencies['@loopback/core']) return false;
    return true;
}

const execPromise = (command) => {
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            resolve({ error, stdout, stderr });
        });
    });
}

module.exports.execute = async (command) => {
    const executed = await execPromise(command);
    if (executed.error) {
        debug(executed.error);
        throw Error(`failed to execute ${command}`);
    }
}

module.exports.kebabCase = string => string
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, '-')
    .toLowerCase();


module.exports.escapeCharacters = (str) => {
    return str.replace(/[\0\x08\x09\x1a\n\r"'\\\%]/g, function (char) {
        switch (char) {
            case "\0":
                return "\\0";
            case "\x08":
                return "\\b";
            case "\x09":
                return "\\t";
            case "\x1a":
                return "\\z";
            case "\n":
                return "\\n";
            case "\r":
                return "\\r";
            case "'":
                return "\'";
            case "\"":
            case "\\":
            case "%":
                return "\\" + char; // prepends a backslash to backslash, percent,
            // and double/single quotes
            default:
                return char;
        }
    });
}

module.exports.toPascalCase = string => string
    .match(/[A-Z]{2,}(?=[A-Z][a-z]+[0-9]*|\b)|[A-Z]?[a-z]+[0-9]*|[A-Z]|[0-9]+/g)
    .map(x => x.charAt(0).toUpperCase() + x.slice(1).toLowerCase())
    .join('');


// Recursive function to get files
module.exports.getFiles = (dir, files = []) => {
    // Get an array of all files and directories in the passed directory using fs.readdirSync
    const fileList = fs.readdirSync(dir)
    // Create the full path of the file/directory by concatenating the passed directory and file/directory name
    for (const file of fileList) {
        const name = `${dir}/${file}`
        // Check if the current file/directory is a directory using fs.statSync
        if (fs.statSync(name).isDirectory()) {
            // If it is a directory, recursively call the getFiles function with the directory path and the files array
            this.getFiles(name, files)
        } else {
            // If it is a file, push the full path to the files array
            files.push(name)
        }
    }
    return files
}