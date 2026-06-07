import { Builder, By } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';

async function run() {
	const options = new firefox.Options();
	options.addArguments('-headless');
	options.setBinary('/opt/firefox/firefox');

	const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).build();
	try {
		for (const url of ['https://www.wired.com/', 'https://www.engadget.com/', 'https://www.theregister.com/', 'https://www.theverge.com/']) {
			console.log(`\n=== Visiting ${url} ===`);
			await driver.get(url);
			await new Promise(r => setTimeout(r, 4000));
			
			const scan = async (context) => {
				const buttons = await driver.executeScript(`
					const out = [];
					for (const el of document.querySelectorAll('button, a, div, span, input')) {
						const t = (el.textContent || '').trim().replace(/\\s+/g, ' ').substring(0, 50);
						if (/\\b(accept|agree|consent|ok|yes)\\b/i.test(t)) {
							let html = el.outerHTML;
							if (html.length > 200) html = html.substring(0, 200) + '...';
							out.push({ tag: el.tagName, text: t, html });
						}
					}
					return out;
				`);
				if (buttons && buttons.length) {
					console.log(`Found in ${context}:`);
					for (const b of buttons) {
						if (b.text.length < 40) console.log(`  [${b.tag}] "${b.text}" -> ${b.html.replace(/\\n/g, '')}`);
					}
				}
			};

			await scan('MAIN');
			const frames = await driver.findElements(By.css('iframe'));
			for (let i = 0; i < frames.length; i++) {
				try {
					await driver.switchTo().frame(frames[i]);
					await scan(`IFRAME ${i}`);
				} catch(e) {} finally {
					try { await driver.switchTo().defaultContent(); } catch(e){}
				}
			}
		}
	} finally {
		await driver.quit();
	}
}
run();
