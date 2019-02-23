const Axios = require("axios");
const R = require("ramda");
const TaskQueue = require("cwait").TaskQueue;

const search_url = "https://www.realestate.com.au/rent/property-house-unit+apartment-townhouse-between-0-500-in-melbourne,+vic+3000;+prahran,+vic+3181;+albert+park,+vic+3206;+brighton,+vic+3186;+armadale,+vic+3143/list-1?activeSort=list-date";
const article = /<article class.*?id='(?<id>\w+)'/g;

function getMatches(string, regex, index) {
      index || (index = 1); // default to the first capturing group
      var matches = [];
      var match;
      while (match = regex.exec(string)) {
              matches.push(match[index]);
            }
      return matches;
}

const formatListingUrl = (article_dom_id) => "https://www.realestate.com.au/" + article_dom_id.replace('t', '');

Axios.get(search_url)
    .then(x => x.data)
    .then(x => getMatches(x, article, 0))
    .then(x => R.map(formatListingUrl, x))
    .then(console.log);

