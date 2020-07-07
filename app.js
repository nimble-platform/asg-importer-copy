const fetch = require("node-fetch");
const utils = require("./utils");

let SR_URL = process.env.SR_URL;
let EFS_URL = process.env.EFS_URL;
let X_API_KEY = process.env.X_API_KEY;
let ROOT_PREFIX = "apis";

let currentIncrement = 10;
var availableRoutes = [];

function nextSlot(current, direction) {
    let inc = direction === 'down' ? -1 : 1;
    let next = current;

    while (availableRoutes.indexOf(next += inc) > -1) ;
    return next;
}

function fillAvailableRoutes(asrJSON){
    let nodes = asrJSON['node']['nodes'];
    if (nodes !== undefined && nodes.length !== 0) {
        for (let i = 0; i < nodes.length; i++) {
            let key = nodes[i].key;
            let routeID = key.substring(key.lastIndexOf("/") + 1, key.length);
            availableRoutes.push(Number(routeID));
        }
    }
}


const syncData = async url => {
    try {
        const srResponse = await fetch(url);
        const srJSON = await srResponse.json();

        const asgResponse = await fetch(`${EFS_URL}/apisix/admin/routes`);
        const asgJSON = await asgResponse.json();

        utils.createOrUpdateEcoEndpoint(asgJSON, EFS_URL, X_API_KEY);
        fillAvailableRoutes(asgJSON);

        // iterate through all the requests
        let apis = srJSON.services;

        if (apis !== undefined) {
            for (let i = 0; i < apis.length; i++) {
                let rootAPI = apis[i];
                for (let j = 0; j < rootAPI.apis.length; j++) {

                    try{
                        let api = rootAPI.apis[j];
                        let url = new URL(api.endpoint);

                        let host = url.hostname;
                        let port = url.port;

                        if(port === undefined || port === ""){
                            if (url.protocol === "http:") {
                                port = 80
                            }else {
                                port = 443
                            }
                        }
                        let hostPort = `${host}:${port}`;

                        let prefix = rootAPI.id + "/" + rootAPI.apis[j].id;
                        let matchingRoute = utils.getMatchingRoute(asgJSON, hostPort, prefix, url.pathname, ROOT_PREFIX);

                        if (matchingRoute === null) {
                            matchingRoute = nextSlot(currentIncrement);
                            currentIncrement += 5;
                        }

                        let regexReplace = `${url.pathname}$1`;
                        if (url.pathname === undefined || url.pathname === "") {
                            regexReplace = `/$1`;
                        }

                        let regex = `^/${ROOT_PREFIX}/${prefix}${url.pathname}(.*)`;

                        const body = {
                            uri: `/${ROOT_PREFIX}/${prefix}${url.pathname}`,
                            plugins: {
                                "proxy-rewrite": {
                                    "regex_uri": [regex, regexReplace]
                                }
                            },
                            upstream: {
                                "type": "roundrobin",
                                "nodes": {
                                    [hostPort]: 1
                                }
                            }
                        };

                        if (url.protocol === "https:") {
                            body.plugins['proxy-rewrite']["scheme"] = "https"
                        }

                        fetch(`${EFS_URL}/apisix/admin/routes/${matchingRoute}`, {
                            method: 'PUT',
                            body: JSON.stringify(body),
                            headers: {
                                'Content-Type': 'application/json',
                                'X-API-KEY': X_API_KEY
                            },
                        })
                            .then(res => {
                                return res.json()
                            })
                            .then(json => {
                                console.log(`created default route ${JSON.stringify(json)}`)
                            })
                            .catch((err) => {
                                console.log(`error occurred while creating the route: ${JSON.stringify(err)}`)
                            })
                    }catch (e) {
                        console.log('error when parsing the routes');
                    }
                }
            }
        }
    } catch (error) {
        console.log(error);
    }
};

syncData(SR_URL);
