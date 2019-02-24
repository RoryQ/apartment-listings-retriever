require("dotenv").config();

const Axios = require("axios");
const R = require("ramda");
const TaskQueue = require("cwait").TaskQueue;
const xpath = require("xpath");
const DOMParser = require("xmldom").DOMParser;
const parser = new DOMParser();

const mariadb = require("mariadb");
const conn = mariadb.createConnection(process.env.CONN_STRING);

const search_url = "https://www.realestate.com.au/rent/property-house-unit+apartment-townhouse-between-0-500-in-melbourne,+vic+3000;+prahran,+vic+3181;+albert+park,+vic+3206;+brighton,+vic+3186;+armadale,+vic+3143/list-1?activeSort=list-date";

const regexes = {
    article_id: /<article class.*?id='(?<id>\w+)'/g,
    article: /(<article.*?<\/article>)/gs
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
const getDetails = (article) => R.pluck("data", xpath.select('//dl[contains(@class,"rui-property-features")]//text()', article));

function constructRecord(article) {
    return {
        id: getId(article),
        address: getAddress(article),
        price: getPrice(article),
        details: getDetails(article)
    };
}

const tick = (async () => {
    const details = await Axios.get(search_url)
        .then(x => x.data)
        .then(x => getMatches(x, regexes.article, 0))
        .then(x => R.map(y => parser.parseFromString(y), x))
        .then(x => R.map(y => constructRecord(y) ,x));

    console.log(await details);
});


