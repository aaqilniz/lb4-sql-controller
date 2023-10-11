const fs = require('fs');
const prettier = require('prettier');

const { Parser } = require('node-sql-parser');

module.exports.parseQuery = (query) => {
    const parser = new Parser();
    return parser.astify(query);
}

module.exports.updateFile = (filePath, updateThis, updateWith, pre, replaceAll) => {
    const file = fs.readFileSync(filePath, 'utf8');
    if (file.indexOf(updateWith) === -1) {
        const updateWithText = pre ? updateWith + '\n' + updateThis : updateThis + '\n\t' + updateWith;
        this.replaceText(filePath, updateThis, updateWithText, replaceAll);
    }
}

module.exports.replaceText = (filePath, updateThis, updateWith, replaceAll) => {
    const file = fs.readFileSync(filePath, 'utf8');
    if (file.indexOf(updateWith) === -1) {
        const updatedFile = file[replaceAll ? 'replaceAll' : 'replace'](
            updateThis,
            updateWith
        );
        fs.writeFileSync(filePath, updatedFile, 'utf8');
    }
}

module.exports.formatCode = async (filePath) => {
    const rawCode = fs.readFileSync(filePath, 'utf8');
    const formatedCode = await prettier.format(rawCode, {
        parser: 'typescript',
        singleQuote: true
    });
    fs.writeFileSync(filePath, formatedCode);
}