const Axios = require("axios");
const xpath = require("xpath");
const R = require("ramda");
const TaskQueue = require("cwait").TaskQueue;
const puppeteer = require("puppeteer");

const xp = {
    articles: '//article'
};

const search_url = "https://www.realestate.com.au/rent/property-house-unit+apartment-townhouse-between-0-500-in-melbourne,+vic+3000;+prahran,+vic+3181;+albert+park,+vic+3206;+brighton,+vic+3186;+armadale,+vic+3143/list-1?activeSort=list-date";

(async () => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto(search_url);
    var articles = await page.$xeval(xp.articles);
    console.log(articles);
})();
