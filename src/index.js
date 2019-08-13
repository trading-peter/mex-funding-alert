'use strict';

const Fetch = require('node-fetch');
const Fs = require('fs-extra');
const Path = require('path');
const D = require('decimal.js');
const Twit = require('twit');

const symbols = [ 'XBT', 'ETH' ];

async function run(dbFile) {
  if (!dbFile) {
    throw Error('Path argument to database file missing');
  }

  if (!await Fs.pathExists(dbFile)) {
    await Fs.mkdirp(Path.dirname(dbFile));
    await Fs.writeJSONSync(dbFile, []);
  }

  const TwitterApi = new Twit({
    consumer_key: process.env.TWITTER_CONSUMER_KEY,
    consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
    access_token: process.env.TWITTER_ACCESS_TOKEN,
    access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
    timeout_ms: 120 * 1000,  // optional HTTP request timeout to apply to all requests.
  });

  let history = await Fs.readJson(dbFile);

  setInterval(async () => {
    try {
      let rates = await Promise.all(symbols.map(symbol => Fetch(`https://www.bitmex.com/api/v1/instrument?symbol=${symbol}&count=1&reverse=true`).then(res => res.json())));
      const results = [];

      if (Array.isArray(rates)) {
        rates = prepFundingRates(rates);

        const recHistory = await Fs.readJSON(Path.join(Path.dirname(dbFile), 'recHistory.json'));
        recHistory.push(rates);
        await Fs.writeJSON(Path.join(Path.dirname(dbFile), 'recHistory.json'), recHistory);

        rates.forEach(rate => {
          const lastRate = history.find(entry => entry.symbol === rate.symbol);

          if (lastRate) {
            const result = compareFunding(lastRate, rate);
            if (result) {
              results.push(result);
            }
          } else {
            history.push({
              symbol: rate.symbol,
              fundingRate: rate.fundingRate,
              timestamp: rate.timestamp
            });
          }
        });

        if (results.length > 0) {
          TwitterApi.post('statuses/update', { status: results.join('\n') }, function(err, data, response) {
            if (err) {
              console.log(err);
            }
          });
        }

        await Fs.writeJSON(dbFile, rates);
        history = rates;
      }
    } catch (err) {
      console.log('Failed to fetch funding', err);
    }
  }, 1000 * 60);
}

function prepFundingRates(rates) {
  const list = [];
  rates = rates.forEach(rates => list.push(...rates));
  rates = list.map(entry => ({
    symbol: entry.symbol,
    fundingRate: entry.fundingRate * 100,
    timestamp: entry.fundingTimestamp
  }));

  return rates;
}

function compareFunding(lastRate, newRate) {
  try {
    const lastType = D(lastRate.fundingRate).gte(0);
    const newType = D(newRate.fundingRate).gte(0);
    const hasFlipped = lastType !== newType;

    const newFunding = D(newRate.fundingRate);
    const lastFunding = D(lastRate.fundingRate);

    if (newFunding.sub(lastFunding).abs().lte(0.0005)) return;
  
    if (hasFlipped) {
      if (newFunding.gt(lastFunding)) {
        return `🚨  Funding for ${newRate.symbol} flipped ↗️ positive from ${lastFunding.toFixed(4)} to ${newFunding.toFixed(4)} (+${D(newFunding).sub(lastFunding).toFixed(4)}).`;
      }
  
      if (newFunding.lt(lastFunding)) {
        return `🚨  Funding for ${newRate.symbol} flipped ↘ negative from ${lastFunding.toFixed(4)} to ${newFunding.toFixed(4)} (-${D(lastFunding).sub(newFunding).toFixed(4)}).`;
      }
    }

    if (newFunding.gt(lastFunding)) {
      return `➕  Funding for ${newRate.symbol} increased from ${lastFunding.toFixed(4)} to ${newFunding.toFixed(4)} (+${D(newFunding).sub(lastFunding).toFixed(4)}).`
    }

    if (newFunding.lt(lastFunding)) {
      return `➖  Funding for ${newRate.symbol} decreased from ${lastFunding.toFixed(4)} to ${newFunding.toFixed(4)} (-${D(lastFunding).sub(newFunding).toFixed(4)}).`
    }
  } catch (err) { /* BitMex probably send invalid data */ }
}

run(process.argv[2]);
