require("dotenv").config();

const Axios = require("axios");
const R = require("ramda");
const natural = require("natural");
const xpath = require("xpath");
const DOMParser = require("xmldom").DOMParser;
const parser = new DOMParser();

const mariadb = require("mariadb");
const pool = mariadb.createPool(process.env.CONN_STRING);

// slack api
const token = process.env.SLACK_TOKEN;
const Slack = require('slack');
const slack = new Slack({token, username: process.env.SLACK_NAME })

// slack rtm bot
const slackbots = require('slackbots');
const bot = new slackbots({token});

const keywords = process.env.KEYWORDS.split(',');
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

// main search function
const tick = (async () => {
    const details = await Axios.get(process.env.SEARCH_URL)
        .then(x => x.data)
        .then(x => getMatches(x, regexes.article, 0))
        .then(x => R.map(y => parser.parseFromString(y), x))
        .then(x => R.map(y => constructRecord(y) ,x));

    const articles = await details;
    console.log(articles);

    await Promise.all(R.map(upsertSearchListing, articles));
    const processable = await Promise.all(R.map(searchListingProcessable, articles));
    const toProcess = R.zipObj(R.pluck("id", articles), processable);
    console.log(toProcess);
    await Promise.all(R.map(notifyIfGoodEnough, R.keys(toProcess)));
});

async function upsertSearchListing(article) {
    let conn;
    try{
        conn = await pool.getConnection();
        const r = await conn.query(
`INSERT INTO listings(
    id, address, short_details, 
    price_pw, price_raw, rooms, 
    car_space)
value (?,?,?, ?,?,?, ?)
ON DUPLICATE KEY UPDATE id=id;`,
            [article.id, article.address, JSON.stringify(article.details), 
             article.price, article.priceRaw, article.details.Bedrooms || 1, 
             !!article.details['Car Spaces'] || 0]
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
`UPDATE listings
SET full_description = ? ,
processed = now(),
garden = ?
WHERE id = ? `,
            [article.description, article.garden || 0, article.id]
        );
        console.log(article.id, r);
    }
    finally {
        if (conn) conn.end();
    }
}

async function updateInterest(notified_ts) {
    let conn
    try{
        conn = await pool.getConnection();
        const r = await conn.query(`update listings set interested = 1 where notified_ts = ?`,
            [notified_ts]);
        console.log(notified_ts, r);
    }
    finally{
        if (conn) conn.end();
    }
}

async function updateNotified(article) {
    let conn
    try{
        conn = await pool.getConnection();
        const r = await conn.query(`update listings set notified_ts = ? where id = ?`,
            [Number(article.notified_ts), article.id]);
        console.log(notified_ts, r);
    }
    finally{
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

async function getArticleRecord(id){
    let conn;
    try{
        conn = await pool.getConnection();
        const r = await conn.query(`select id, address, rooms, car_space, garden, price_raw, notified_ts from listings where id = ?`, [id]);
        return r[0];
    }
    finally{
        if (conn) conn.end();
    }
}

async function getDescription(article_id){
    let resp
    try{
    const r = await Axios.get("http://www.realestate.com.au/" + article_id)
        .then(x => x.data)
        .then(x => getMatches(x, regexes.article_page_body, 0)[0])
        console.log(article_id, r);
        return r;
    }
    catch (e){
        printAxiosError(e)
        return null;
    }
}

function printAxiosError(e) {
    if (e.response){
        console.error(e.response.status, e.response.statusText);
    }
    else if (e.message){
        console.error(e.message);
    }
}

async function notifyIfGoodEnough(article_id){
    let article = {id: article_id};
    const description = await getDescription(article_id);
    if (description) {
        article = { ...article, description };
        await updateDescription(article);
        var hasMatch = R.any(x => R.contains(x, description), stems);
    }
    if (!hasMatch) 
        return;

    console.log(article.id, 'hasMatch: true');
    article = await getArticleRecord(article.id);
    if (!!article.notified_ts) 
        return;

    const garden = R.contains('garden', description);
    article = {...article, garden};
    console.log(article);
    const ts = await postToSlack(article);
    console.log(article.id, ts);
    article = { ...article, notified_ts: ts }
    await updateNotified(article);
}

const booleanEmojii = (value) => value ? ':heavy_check_mark:' : ':x:';

async function postToSlack(article){
    let m = await slack.chat.postMessage({channel:'listings',
        text:
`${article.address}
${article.price_raw} 
rooms: ${article.rooms} 
car_space: ${booleanEmojii(!!article.car_space)}
garden: ${booleanEmojii(!!article.garden)}
https://www.realestate.com.au/${article.id}
`})
    return m.ts;
}

function startSlackBot(){
    bot.on('message', (data) => {
        console.log(data);

        if (data.type === 'reaction_added'){
            updateInterest(data.item.ts);
        }
    });
}


startSlackBot();
intervalMins = process.env.INTERVAL_MINS
setInterval(tick, 1000 * 60 * intervalMins);
tick();