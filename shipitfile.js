// This shipitfile handles deployment of local files defined in `dirToCopy`.
// `grunt build` has to run before initiating this shipitfile which expects
// the final built files in `dist` directory.
//
// If deployed in AWS, set the `USE_PRIVATE_DNS` environment variable to a 
// truthy value to deploy using internal IP addresses instead of external IPs

const process = require('process');
const ncp = require('ncp');
const USE_PRIVATE_DNS = process.env.CL_USE_PRIVATE_DNS ? true : false;

module.exports = function (shipit, tasks, cometaws) {
    var cometAws = new cometaws.CometAws({
        env: shipit.environment,
        region: 'eu-west-1'
    });
    var cometDeployer = new cometaws.CometDeployer(cometAws, shipit);

    cometDeployer.tags = [{
        Key: 'Role',
        Value: 'cl-web'
    }];

    if (!USE_PRIVATE_DNS) {
        cometDeployer.usePrivateDns = false;
    }

    var config = {
        default: {
            repositoryUrl: 'git@github.com:cometcult/lunch-button.git',
            workspace: '/tmp/lunch-button-www-shipit',
            dirToCopy: 'dist',
            ignores: ['.git'],
            keepReleases: 5,
            deleteOnRollback: false
        },
        development: {
            deployTo: '/srv/development/lunch-button-www',
            branch: 'develop'
        },
        production: {
            deployTo: '/srv/production/lunch-button-www',
            branch: 'master'
        }
    };
    return cometDeployer.configureShipit(shipit, config).then( config => {
        require('shipit-deploy')(shipit);

        shipit.task('cl:deploy', ['deploy']);
        shipit.blTask('cl:deploy-pr', () => {
            var prNumber = process.env.PR;
            var deployTo = `/srv/prs/lunch-button/pr${process.env.PR}`;

            // rsync changes to a PR directory
            return shipit.remote(`mkdir -p ${deployTo}`)
                .then( () => shipit.remoteCopy(`${shipit.config.dirToCopy}/`, deployTo, {
                    'rsync': '--del'
                }))
                .then( () => shipit.start('cl:nginx:reload'));
        });

        shipit.blTask('cl:copy-local-dist', () => {
            return new Promise( (resolve, reject) => {
                ncp(shipit.config.dirToCopy, shipit.config.workspace + '/' + shipit.config.dirToCopy, function (err) {
                    if (err) {
                        reject(err);
                        return console.error(err);
                    }
                    resolve();
                });
            });
        });
        shipit.task('cl:nginx:reload', () => {
            return shipit.remote('sudo service nginx configtest && sudo service nginx reload');
        });

        shipit.on('fetched', () => {
            shipit.start('cl:copy-local-dist');
        });
        shipit.on('published', () => {
            shipit.start('cl:nginx:reload');
        });

        var serverList = config.servers.join(', ');
        console.log(`Configuring tasks for [${shipit.environment}] environment on servers [${serverList}]`);
    });
};
