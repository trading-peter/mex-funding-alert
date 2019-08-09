'use strict';

const Fetch = require('node-fetch');
const Fs = require('fs-extra');
const Path = require('path');

const symbols = [ 'XBT', 'ETH' ];

async function run(dbFile) {
  if (!dbFile) {
    throw Error('Path argument to database file missing');
  }

  if (!await Fs.pathExists(dbFile)) {
    await Fs.mkdirp(Path.dirname(dbFile));
    await Fs.writeJSONSync(dbFile, []);
  }

  let history = await Fs.readJson(dbFile);

  setInterval(async () => {
    try {
      let rates = await Promise.all(symbols.map(symbol => Fetch(`https://www.bitmex.com/api/v1/instrument?symbol=${symbol}&count=1&reverse=true`).then(res => res.json())));
      const results = [];
      
      if (Array.isArray(rates)) {
        rates = prepFundingRates(rates);

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
          console.log(results.join('\n'));
        }

        await Fs.writeJSON(dbFile, rates);
        history = rates;
      }
    } catch (err) {
      console.log('Failed to fetch funding', err);
    }
  }, 1000 * 4);
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
    const lastType = lastRate.fundingRate < 0 ? 'Shorts pay Longs' : 'Longs pay shorts';
    const newType = newRate.fundingRate < 0 ? 'Shorts pay Longs' : 'Longs pay shorts';
  
    if (lastType !== newType) {
      return `Funding flipped for ${newRate.symbol}. ${newType} (${newRate.fundingRate})`;
    }
  } catch (err) { /* BitMex probably send invalid data */ }
}

run(process.argv[2]);
