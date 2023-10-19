'use strict';

const fs = require('fs');
const { pipeline } = require('stream');
const util = require('util');

const AdmZip = require('adm-zip');
const path = require('path');
const iconv = require('iconv-lite');
const { parseString } = require('xml2js');

const pipelineAsync = util.promisify(pipeline);

const rootTmp = path.join(process.cwd(), 'tmp');
const fileName = 'cbr';
const ext = {
  zip: '.zip',
  xml: '.xml',
  json: '.json',
};

const stop = () => {
  process.exit(0);
};

process.once('SIGTERM', stop);
process.on('SIGINT', stop);

async function downloadZip(url) {
  try {
    const response = await fetch(url);

    if (response.ok) {
      const writeFile = fs.createWriteStream(
        pathToFile(`${fileName}${ext.zip}`),
      );

      await pipelineAsync(response.body, writeFile);

      console.log('ZIP-file load success.');
    } else {
      throw new Error(`Fail load. Status code: ${response.status}`);
    }
  } catch (e) {
    console.error('Error load file:', e.message);
    throw e;
  }
}

async function zipToXml() {
  try {
    const zip = new AdmZip(pathToFile(`${fileName}${ext.zip}`));
    const zipEntries = zip.getEntries();

    for (const entry of zipEntries) {
      const entryName = entry.entryName;

      if (entryName.endsWith('.xml')) {
        const entryData = entry.getData();
        const decodedData = iconv.decode(entryData, 'UTF-8');

        const file = pathToFile(`${fileName}${ext.xml}`);

        fs.writeFileSync(file, decodedData, { encoding: 'utf-8' });
      }
    }

    console.log('ZIP-file success unzipped.');
  } catch (error) {
    console.error('Error unzipped file:', error);
  }
}

async function xmlToJson() {
  try {
    const data = fs.readFileSync(pathToFile(`${fileName}${ext.xml}`), {
      encoding: 'utf8',
      flag: 'r',
    });

    const dataJson = await new Promise((resolve, reject) => {
      parseString(data, (err, result) => {
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      });
    });

    const result = parseJson(dataJson);

    const jsonData = JSON.stringify(result, null, 2);

    const jsonFilePath = pathToFile(`${fileName}${ext.json}`);

    fs.writeFileSync(jsonFilePath, jsonData, { encoding: 'utf-8' });

    console.log('XML success converted in JSON and saved.');
  } catch (err) {
    console.error('Error xml ti json:', err);
  }
}

function parseJson(obj) {
  let result = [];

  for (const key in obj) {
    const bicArr = obj[key]?.['BICDirectoryEntry'];

    if (!bicArr) {
      continue;
    }

    const res = bicArr.reduce((acc, cur) => {
      // eslint-disable-next-line no-prototype-builtins
      if (cur instanceof Object && !cur.hasOwnProperty('Accounts')) {
        return acc;
      }
      const bic = cur?.['$']?.['BIC'];
      const name = cur?.['ParticipantInfo']?.[0]?.['$']?.['NameP'];

      if (!bic || !name) {
        return acc;
      }

      const resAccounts = cur['Accounts'].reduce((accAcc, curAcc) => {
        const corrAccount = curAcc?.['$']?.['Account'];

        if (!curAcc) {
          return accAcc;
        }
        accAcc.push({ bic, name, corrAccount });
        return accAcc;
      }, []);

      return [...acc, ...resAccounts];
    }, []);

    result = [...result, ...res];
  }

  return result;
}

function pathToFile(fileName) {
  return path.join(rootTmp, fileName);
}

(async () => {
  try {
    const url = 'http://www.cbr.ru/s/newbik';

    await downloadZip(url);

    await zipToXml();

    await xmlToJson();

    const logError = (err) => {
      console.error(err ? err.stack : 'No exception stack available');
    };

    process.on('uncaughtException', logError);
    process.on('warning', logError);
    process.on('unhandledRejection', logError);

    fs.readdir(rootTmp, (err, files) => {
      if (err) {
        console.error('Error read dir:', err);
        return;
      }

      files.forEach((file) => {
        const { ext: extFile } = path.parse(file);
        if (extFile === ext.json) return;
        fs.unlink(pathToFile(file), (err) => {
          if (err) {
            console.error(`Error delete file name ${file}:`, err);
            return;
          }

          console.log(`File ${file} delete success.`);
        });
      });
    });
  } catch (error) {
    throw new Error(error);
  }
})();
