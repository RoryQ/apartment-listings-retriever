require("dotenv").config();

const Axios = require("axios");
const R = require("ramda");
const TaskQueue = require("cwait").TaskQueue;
const natural = require("natural");
const xpath = require("xpath");
const DOMParser = require("xmldom").DOMParser;
const parser = new DOMParser();

const mariadb = require("mariadb");
const pool = mariadb.createPool(process.env.CONN_STRING);

const SlackBots = require("slackbots");
const slack = new SlackBots({
    token: process.env.SLACK_TOKEN,
    name: process.env.SLACK_NAME
});

const search_url = "https://www.realestate.com.au/rent/property-house-unit+apartment-townhouse-between-0-500-in-melbourne,+vic+3000;+prahran,+vic+3181;+albert+park,+vic+3206;+brighton,+vic+3186;+armadale,+vic+3143/list-1?activeSort=list-date";

const keywords = ["garden", "courtyard", "dishwasher"];
const stems = R.map(natural.PorterStemmer.stem, keywords);

const regexes = {
    article_id: /<article class.*?id='(?<id>\w+)'/g,
    article: /(<article.*?<\/article>)/gs,
    article_page_body: /<p class="body".*?>(.*?)<\/p>/gs
}

function getMatches(string, regex, index) {
      index || (index = 1); // default to the first capturing group
      var matches = [];
      var match;
      while (match = regex.exec(string)) {
              matches.push(match[index]);
            }
      return matches;
}

const getId = (article) => xpath.select1('//@id', article).value.replace("t", "");
const getAddress = (article) => xpath.select1('//a[@class="name"]/text()', article).data;
const getPrice = (article) => xpath.select1('//p[@class="priceText"]/text()', article).data;
const pluckDetails = (article) => R.pluck("data", xpath.select('//dl[contains(@class,"rui-property-features")]//text()', article));
const formatDetails = (details) => R.fromPairs( R.splitEvery(2, R.filter(x => x != " ", details)))

function constructRecord(article) {
    return {
        id: Number(getId(article)),
        address: getAddress(article),
        price: /\d+/.exec(getPrice(article))[0],
        priceRaw: getPrice(article),
        details: formatDetails(pluckDetails(article))
    };
}

const tick = (async () => {
    const details = await Axios.get(search_url)
        .then(x => x.data)
        .then(x => getMatches(x, regexes.article, 0))
        .then(x => R.map(y => parser.parseFromString(y), x))
        .then(x => R.map(y => constructRecord(y) ,x));

    const articles = await details;

    await Promise.all(R.map(upsertSearchListing, articles));
    const processable = await Promise.all(R.map(searchListingProcessable, articles));
    const toProcess = R.zipObj(R.pluck("id", articles), processable);
    console.log(toProcess);
});

async function upsertSearchListing(article) {
    let conn;
    try{
        conn = await pool.getConnection();
        const r = await conn.query(
            `INSERT INTO listings(id, address, short_details, price_pw, price_raw, rooms)
         value (?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE
            id=id;`,
            [article.id, article.address, JSON.stringify(article.details), article.price, article.priceRaw, article.details.Bedrooms]
        );
        console.log(article.id, r);
    }
    finally{
        if (conn) conn.end();
    }
}

async function updateDescription(article) {
    let conn;
    try {
        conn = await pool.getConnection();
        const r = await conn.query(
            `UPDATE l
            SET full_description = ? ,
            notified = ? ,
            car_space = ? ,
            `
        );
    }
    finally {
        if (conn) conn.end();
    }
}

async function searchListingProcessable(article) {
    let conn;
    try{
        conn = await pool.getConnection();
        const r = await conn.query(`select 1 from listings where id = ? and processed is null`, [article.id]);
        conn.end();
        return r.length == 1
    }
    finally{
        if (conn) conn.end();
    }
}

async function getDescription(article_id){
    const r = await Axios.get("http://www.realestate.com.au/" + article_id)
        .then(x => x.data)
        .then(x => getMatches(x, regexes.article_page_body, 0)[0])
    console.log(article_id, r);
    return r;
}

async function processSearchListing(article_id){
    const description = await getDescription(article_id);
    const hasMatch = R.any(x => R.contains(x, details), stems);
}

function startSlackBot(){
    slack.on('message', (data) => {
        console.log(data);
    });
}

startSlackBot();

//(async () => await processSearchListing(425937478))();
//tick();
