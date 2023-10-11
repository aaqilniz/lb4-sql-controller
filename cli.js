const fs = require('fs');
const yargs = require('yargs/yargs');

const { parseQuery, updateFile, formatCode } = require('./helpers');

module.exports = async () => {
    const { query } = yargs(process.argv.slice(2)).argv;
    if(!query) return process.exit(0);
    // const query = `select * from doctor where id=1`;
    // const query = `select * from employees where reportsTo=1`;
    const invokedFrom = process.cwd();
    const controllerDirPath = `${invokedFrom}/src/controllers`;
    if (!fs.existsSync(controllerDirPath)) fs.mkdirSync(controllerDirPath);

    // const query = `select reportsTo, count(*) from employees group by reportsTo`;
    // const query = `select reportsTo, count(*) as employeesCount from employees group by reportsTo`;
    const parsedQuery = parseQuery(query);
    console.log(parsedQuery.from);
    const {
        type,
        columns,
        from,
        where,
        groupby,
        orderby,
        limit,
    } = parsedQuery;

    let method = '';
    let models = [];
    let filter = {};

    switch (type) {
        case 'select':
            method = 'get'
            break;
        default:
            break;
    }

    from.forEach(({ table }) => { models.push(table) });

    if (limit) filter.limit = limit;
    if (where) {
        filter.where = {};
        switch (where.operator) {
            case '=':
                filter.where[where.left.column] = where.right.value;
                break;
            default:
                break;
        }
    }

    if (columns) {
        filter.fields = [];
        columns.forEach(({ expr }) => {
            if (expr.column === '*') {
                delete filter.fields;
                return;
            };
            if (expr.type === 'column_ref') {
                filter.fields.push(expr.column);
            }
            if (expr.type === 'aggr_func') {
                if (expr.as) {
                    // we have count(*) with as
                    // filter.fields.push(expr.column)
                }
                if (expr.name === 'COUNT') {
                    //count function column name as co
                }
            }
        });
    }

    let modelImports = [];
    let repoImports = [];
    let modelsString = models.toString();

    models.forEach(model => {
        model = model.replace(/(\w)(\w*)/g,
            function (g0, g1, g2) { return g1.toUpperCase() + g2.toLowerCase(); })
        modelImports.push(model);
        repoImports.push(`${model}Repository`);
    });

    let depInjection = ``;

    repoImports.forEach(repoImport => {
        depInjection += `@repository(${repoImport})
    public ${repoImport.replace(/(?:^\w|[A-Z]|\b\w|\s+)/g, function (match, index) {
            if (+match === 0) return "";
            return index === 0 ? match.toLowerCase() : match.toUpperCase();
        })}: ${repoImport}`
    });

    const controllerIndexPath = `${invokedFrom}/src/controllers/index.ts`;
    const controllerPath = `${controllerDirPath}/${modelsString}.controller.ts`;

    let controller = `
    import { get, getModelSchemaRef, param } from '@loopback/rest';
    import { repository } from '@loopback/repository';
    import { ${modelImports.toString()} } from '../models';
    import { ${repoImports.toString()} } from '../repositories';

    export class Custom${modelsString}Controller {
    constructor(${depInjection}) {}
    @get('/custom-${modelsString}', {
        responses: {
        '200': {
            description: 'Records of ${modelsString}',
            content: {
            'application/json': {
                schema: {},
            },
            },
        },
        },
    })
    async custom${modelsString}(): Promise<${modelImports[0]}[]> {
        return this.${repoImports[0].replace(/(?:^\w|[A-Z]|\b\w|\s+)/g, function (match, index) {
        if (+match === 0) return ""; // or if (/\s+/.test(match)) for white spaces
        return index === 0 ? match.toLowerCase() : match.toUpperCase();
    })}.find();
    }
}
    `;

    if (!fs.existsSync(controllerPath)) {
        fs.writeFileSync(controllerPath, controller);
    }

    if (!fs.existsSync(controllerIndexPath)) {
        fs.writeFileSync(controllerIndexPath, `export * from \'./${modelsString}.controller\';`);
    } else {
        updateFile(
            controllerIndexPath,
            'export',
            `export * from \'./${modelsString}.controller\';`,
            true
        );
    }
    await formatCode(`${invokedFrom}/src/controllers/${modelsString}.controller.ts`);
}
