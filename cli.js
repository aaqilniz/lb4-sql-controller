const fs = require('fs');
const yargs = require('yargs/yargs');

const {
    parseQuery,
    updateFile,
    formatCode,
    toPascal,
    toCamelCase,
} = require('./helpers');

module.exports = async () => {
    const { query } = yargs(process.argv.slice(2)).argv;
    if (!query) return process.exit(0);
    const invokedFrom = process.cwd();
    const controllerDirPath = `${invokedFrom}/src/controllers`;
    if (!fs.existsSync(controllerDirPath)) fs.mkdirSync(controllerDirPath);
    const parsedQuery = parseQuery(query);
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
    let queryParams = [];
    let countCode = '';
    let isCount = false;
    let methodImplementation = '';
    let returnType = 'Promise<any>';

    switch (type) {
        case 'select':
            method = 'get'
            break;
        default:
            break;
    }

    from.forEach(({ table }) => { models.push(table) });

    if (limit) {
        if (limit.value) {
            if (limit.value.length) {
                filter.limit = limit.value[0].value;
            }
        }
    }
    if (where) {
        filter.where = {};
        switch (where.operator) {
            case '=':
                queryParams.push({
                    dbField: where.left.column,
                    queryField: where.right.column,
                })
                filter.where[where.left.column] = where.right.column;
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
                    isCount = true;
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

    const findCode = `this.${toCamelCase(repoImports[0])}.find(${JSON.stringify(filter)});`;

    if (isCount) {
        countCode = `const { count } = await this.${toCamelCase(repoImports[0])}.count();`;
    }

    if (countCode) {
        methodImplementation = `
            return new Promise(async (resolve, reject) => {
                try {
                    ${countCode}
                    const ${models[0]} =  await ${findCode}
                    resolve({count, ${models[0]}})
                    } catch (error) {
                    reject(error);
                }
            })
        `;
    } else {
        returnType = `Promise<${modelImports[0]}[]>`;
        methodImplementation = `return ${findCode}`;
    }

    repoImports.forEach(repoImport => {
        depInjection += `@repository(${repoImport})
    public ${toPascal(repoImport)}: ${repoImport}`
    });
    const controllerIndexPath = `${invokedFrom}/src/controllers/index.ts`;
    const controllerPath = `${controllerDirPath}/${modelsString}.controller.ts`;
    let queryArg = '';
    if (queryParams.length) {
        if (queryParams[0].queryField) {
            queryArg = `@param.query.string('${queryParams[0].queryField}') ${queryParams[0].queryField}: any`;
        }

    }
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
    async custom${modelsString}(${queryArg ? queryArg : ''}): ${returnType} {
        ${methodImplementation}
    }
}
    `;
    if (filter) {
        if (filter.where) {
            const replaceThis = `"${Object.keys(filter.where)[0]}":"${filter.where[Object.keys(filter.where)[0]]}"`;
            const withThis = `"${Object.keys(filter.where)[0]}":${filter.where[Object.keys(filter.where)[0]]}`;
            controller = controller.replace(replaceThis, withThis);
        }

    }

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
