const yargs = require('yargs/yargs');
const fs = require('fs');
const { Project } = require('ts-morph');

const {
  getVariables,
  getProperties,
  getTableNames,
  isLoopBackApp,
  execute,
  kebabCase,
  escapeCharacters,
  toPascalCase,
  getFiles,
} = require('./helpers');

module.exports = async () => {
  let { query, path, repoName, controllerName, config } = yargs(process.argv.slice(2)).argv;

  if (config && typeof config === 'string') {
    config = JSON.parse(config);
    query = config.query;
    path = config.path;
    repoName = config.repoName;
    controllerName = config.controllerName;
  }

  if (!query) throw new Error('query is required');
  if (!path) throw new Error('path is required');
  if (!controllerName) throw new Error('controllerName is required');

  let repoClass = '';
  if (repoName) {
    repoClass = `${toPascalCase(repoName)}Repository`;
  }

  const invokedFrom = process.cwd();
  const package = require(`${invokedFrom}/package.json`);

  if (!isLoopBackApp(package)) throw Error('Not a loopback project');

  const repoDirPath = `${invokedFrom}/src/repositories`;
  let repoPath = '';

  if (repoName) {
    repoPath = `${repoDirPath}/${kebabCase(repoName)}.repository.ts`;
  }

  const project = new Project({
    tsConfigFilePath: `${invokedFrom}/tsconfig.json`,
  });


  if (!fs.existsSync(repoPath)) {
    const repoFiles = getFiles(repoDirPath);
    for (let i = 0; i < repoFiles.length; i++) {
      const filePath = repoFiles[i];
      if (
        !filePath.includes('index') &&
        !filePath.includes('README') &&
        filePath.includes('.ts')
      ) {
        const repoSourceFile = project.addSourceFileAtPath(filePath);
        repoClass = repoSourceFile.getClasses()[0]?.getName();
      }
    }
  }
  if (!repoClass) { throw new Error('Please generate the reposotires first.'); }

  const imports = [
    {
      namedImports: 'repository',
      moduleSpecifier: '@loopback/repository'
    },
    {
      namedImports: `${repoClass}`,
      moduleSpecifier: '../repositories'
    },
    {
      namedImports: ['get', 'param', 'HttpErrors'],
      moduleSpecifier: '@loopback/rest'
    },
  ]

  const variables = getVariables(query);
  const { selectedProperties, columns } = getProperties(query);
  const tableNames = getTableNames(query);

  const modelDirPath = `${invokedFrom}/src/models`;
  if (!fs.existsSync(modelDirPath)) fs.mkdirSync(modelDirPath);

  const propertyTypes = {};

  tableNames.forEach(tableName => {
    const modelPath = `${modelDirPath}/${kebabCase(tableName)}.model.ts`;
    const modelSourceFile = project.addSourceFileAtPath(modelPath);
    const modelProperties = modelSourceFile.getClasses()[0].getProperties();
    modelProperties.forEach(modelProperty => {
      const typeText = modelProperty.getType().getText();
      const type = typeText.split(' | ')[0];
      propertyTypes[modelProperty.getName()] = type;
    });
  });

  let propertiesSchema = '';
  let schema = '';
  let parametersSchema = '';

  const modelName = toPascalCase(tableNames[0]);

  Object.keys(selectedProperties).forEach(key => {
    if (key === 'all') {
      schema = `getModelSchemaRef(${modelName})`;
      imports.push({
        namedImports: ['getModelSchemaRef'],
        moduleSpecifier: '@loopback/rest'
      });
      imports.push({
        namedImports: [modelName],
        moduleSpecifier: '../models'
      })
    } else {
      const { key: property, type: typeFromQuery } = selectedProperties[key];
      let type = propertyTypes[key] || typeFromQuery || 'string';
      if (property === 'count' || property === 'COUNT') type = 'number';
      propertiesSchema += `${key}: { type: '${type}'}, `;
    }
  });
  if (propertiesSchema) {
    schema = `{ properties: {${propertiesSchema}} }`
  }

  variables.forEach(variable => {
    let type = propertyTypes[columns[variable] || variable] || 'string';
    parametersSchema += `${variable}: { type: '${type}'}, `;
  });

  const controllerDirPath = `${invokedFrom}/src/controllers`;
  if (!fs.existsSync(controllerDirPath)) fs.mkdirSync(controllerDirPath);

  const controllerPath = `${controllerDirPath}/${kebabCase(controllerName)}.controller.ts`;
  if (!fs.existsSync(controllerPath)) {
    await execute(`
    lb4 controller --config '{ "name": "${controllerName}", "controllerType": "Empty Controller"}' --yes`,
      'generating controller.');
  }

  const sourceFile = project.addSourceFileAtPath(controllerPath);

  const controllerClass = sourceFile.getClasses()[0];

  const file = fs.readFileSync(controllerPath, 'utf8');

  if (file.indexOf('HttpErrors') === -1) {
    sourceFile.addImportDeclarations(imports);
  }

  const contructorMethod = controllerClass.getConstructors()[0];

  if (file.indexOf(`${repoClass}`) === -1) {
    contructorMethod.addParameters([
      {
        name: 'repo',
        type: `${repoClass}`,
        scope: 'public'
      }
    ]);
  }

  if (file.indexOf(`@repository(${repoClass})`) === -1) {
    contructorMethod.getParameter('repo').addDecorator({
      name: 'repository',
      arguments: [`${repoClass}`]
    });
  }

  if (file.indexOf('executeSQLQuery') === -1) {
    const method = {
      name: 'executeSQLQuery',
      isAsync: true,
      returnType: 'Promise<any>',
    };
    if (parametersSchema !== '') {
      method.parameters = [{
        name: 'sqlParams',
        type: `{ ${parametersSchema} }`,
      }]
    }
    controllerClass.addMethod(method);
  }

  const method = controllerClass.getMethod('executeSQLQuery');

  if (file.indexOf('@get(\'') === -1) {
    method.addDecorator({
      name: 'get',
      arguments: [
        `'${path}'`,
        `{ responses: { default: { description: 'Something unexpected happens.' }, '200': { description: 'Successfully executes the query.', content: { 'application/json': { ${schema ? `schema: ${schema}` : ''} } } } } }`
      ],
    });
  }

  const parameter = method.getParameter('sqlParams');
  if (file.indexOf('param.query.object') === -1 && parametersSchema !== '') {
    parameter.addDecorator({
      name: 'param.query.object',
      arguments: [
        `'sqlParams'`,
        `{ properties: { ${parametersSchema} }}`
      ],
    });
  }

  if (file.indexOf('return new HttpErrors') === -1 && variables.length) {
    method.addStatements(`if(!sqlParams) return new HttpErrors[422]('The sqlParams is required');`);
  }
  if (file.indexOf(`} = sqlParams;`) === -1 && variables.length) {
    method.addStatements(`const { ${variables.toString()} } = sqlParams;`);
  }
  if (file.indexOf('const rawQuery =') === -1) {
    query = query.replace(/distinct\("([^"]*)"\)/g, 'distinct($1)');
    method.addStatements(`const rawQuery = \`${escapeCharacters(query)}\``);
  }
  if (file.indexOf('return this.repo.execute(rawQuery);') === -1) {
    method.addStatements('return this.repo.execute(rawQuery);');
  }

  sourceFile.formatText();

  await project.save();
  console.log('successfully generated the controller.');
}
