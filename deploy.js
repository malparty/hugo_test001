const SftpClient = require('ssh2-sftp-client');
const sftp = new SftpClient();

const util = require('util');
const glob = util.promisify(require('glob'));
const upath = require('upath');
const fs = require('fs');

const remotePathBase = '/home/malparty/code';

const ignoredRemoteItems = new Set(['.well-know', 'cgi-bin', '.htaccess', 'favicon.ico']);

let itemsToUpload = [];

if (!process.env.FTP_DEPLOY_HOST) throw new Error('Env variable FTP_DEPLOY_HOST not declared');
if (!process.env.FTP_DEPLOY_PORT) throw new Error('Env variable FTP_DEPLOY_PORT not declared');
if (!process.env.FTP_DEPLOY_USERNAME) throw new Error('Env variable FTP_DEPLOY_USERNAME not declared');
if (!process.env.FTP_DEPLOY_PASSWORD) throw new Error('Env variable FTP_DEPLOY_PASSWORD not declared');


try {
    sftp.connect({
        host: process.env.FTP_DEPLOY_HOST,
        port: process.env.FTP_DEPLOY_PORT,
        username: process.env.FTP_DEPLOY_USERNAME,
        password: process.env.FTP_DEPLOY_PASSWORD,
    })
        .then(() => scanLocalFiles())
        .then(items => {
            if (!items || items.length < 1) throw new Error('Nothing to upload.');
            itemsToUpload = items;
        })
        .then(() => cleanRemote())
        .then(() => createDirecotriesFor(itemsToUpload))
        .then(() => uploadFilesFor(itemsToUpload))
        .then(() => sftp.end()));
} catch (err) {
    console.log('Something wrong just happened - before end()');
    console.error(err);
    sftp.end();
    process.exit(1);
}

function scanLocalFiles() {
    let localPublicPathDirectory = upath.join(process.cwd(), 'public');
    return glob(`${localPublicPathDirectory}/**/*`).then(globMatches => {
        let items = globMatches.map(path => {
            return {
                isDirectory: fs.lstatSync(path).isDirectory(),
                localPath: path,
                remotePath: upath.join(
                    remotePathBase,
                    upath.relative(localPublicPathDirectory, path)
                )
            }
        });
        console.log(items.filter(t => t.isDirectory));
        return items;
    });
}

function cleanRemote() {

    return sftp.list(remotePathBase)
        .then(objectsList => {

            objectsList = objectsList.filter(obj => !ignoredRemoteItems.has(obj.name));
            let dirToRemove = objectsList
                .filter(obj => obj.type === 'd')
                .map(obj => obj.name);
            let fileToRemove = objectsList
                .filter(obj => obj.type === '-')
                .map(obj => obj.name);
            let operations = dirToRemove.map(dir =>
                sftp.rmdir(upath.join(remotePathBase, dir), true)
                    .then(() => console.log(`Remove directory: ${dir}`)))
                .concat(fileToRemove.map(file =>
                    sftp.delete(upath.join(remotePathBase, file))
                        .then(() => console.log(`Remove file: ${file}`))));
            return Promise.all(operations);
        });
}
function createDirecotriesFor(items) {
    var directories = items.filter(path => path.isDirectory);
    return Promise.all(
        directories.map(dir => sftp.mkdir(dir.remotePath)
            .then(() => console.log(`Created dir: ${dir.remotePath}`)))
    );
}


function uploadFilesFor(items) {
    var files = items.filter(path => !path.isDirectory);
    return Promise.all(files.map(
        f => sftp.put(f.localPath, f.remotePath)
            .then(() => console.log(`Uploaded file: ${f.remotePath}`))
    )
    );

}