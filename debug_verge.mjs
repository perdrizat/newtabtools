import { Builder, By } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';

async function run() {
	const options = new firefox.Options();
	options.addArguments('-headless');
	options.setBinary('/opt/firefox/firefox');

	const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).build();
	try {
		console.log(`\n=== Visiting https://www.theverge.com/ ===`);
		await driver.get('https://www.theverge.com/');
		await new Promise(r => setTimeout(r, 4000));
		
		const vergeHTML = await driver.executeScript(`
			let out = [];
			const header = document.querySelector('header');
			if (header) out.push('HEADER: ' + header.outerHTML.substring(0, 500));
			
			const ads = document.querySelectorAll('[class*="ad"], [id*="ad"]');
			for (let i=0; i<Math.min(ads.length, 5); i++) {
				out.push('AD ' + i + ': ' + ads[i].outerHTML.substring(0, 300));
			}
			return out.join('\\n');
		`);
		console.log(vergeHTML);
		
	} finally {
		await driver.quit();
	}
}
run();
