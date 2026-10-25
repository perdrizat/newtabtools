import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { ensureSiteEnv } from './_helpers.ts';

describe('Transformation — webextension/transformation.js', () => {
	beforeAll(async () => {
		await ensureSiteEnv();
	});

	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('_whenTransitionEnded calls callback when matching transitionend fires', async () => {
		const { Transformation } = await import('../../webextension/transformation.js');
		const node = document.createElement('div');
		const cb = vi.fn();

		(Transformation as any)._whenTransitionEnded(node, ['opacity'], cb);

		const event = new Event('transitionend') as any;
		event.propertyName = 'opacity';
		node.dispatchEvent(event);

		expect(cb).toHaveBeenCalledTimes(1);
	});

	it('_whenTransitionEnded invokes callback via fallback timeout if transitionend never fires', async () => {
		const { Transformation } = await import('../../webextension/transformation.js');
		const node = document.createElement('div');
		const cb = vi.fn();

		(Transformation as any)._whenTransitionEnded(node, ['opacity'], cb);

		expect(cb).not.toHaveBeenCalled();

		vi.advanceTimersByTime(300);

		expect(cb).toHaveBeenCalledTimes(1);
	});

	it('freezeSitePosition triggers Grid.cacheCellPositions if cell position is unpopulated', async () => {
		const { Transformation } = await import('../../webextension/transformation.js');
		const { Grid } = await import('../../webextension/grid.js');

		const cacheSpy = vi.fn(() => {
			(Grid as any)._cells = [
				{ index: 0, position: { left: 10, top: 20, width: 100, height: 80 } },
			];
		});
		(Grid as any).cacheCellPositions = cacheSpy;
		(Grid as any)._cells = [
			{ index: 0, position: undefined },
		];

		const node = document.createElement('div');
		const site = {
			node,
			cell: (Grid as any)._cells[0],
		};

		Transformation.freezeSitePosition(site as any);

		expect(cacheSpy).toHaveBeenCalled();
		expect(site.node.getAttribute('frozen')).toBe('true');
		expect(site.node.style.top).toBe('20px');
		expect(site.node.style.left).toBe('10px');
	});

	it('slideSiteTo triggers Grid.cacheCellPositions if target position is unpopulated', async () => {
		const { Transformation } = await import('../../webextension/transformation.js');
		const { Grid } = await import('../../webextension/grid.js');

		const target = {
			index: 1,
			position: undefined as any,
		};
		(Grid as any).cacheCellPositions = vi.fn(() => {
			target.position = { left: 150, top: 20, width: 100, height: 80 };
		});

		const node = document.createElement('div');
		const site = {
			node,
			index: 0,
			cell: { index: 0 },
		};

		const finish = vi.fn();
		Transformation.slideSiteTo(site as any, target as any, { callback: finish });

		expect((Grid as any).cacheCellPositions).toHaveBeenCalled();
		expect(site.node.style.left).toBe('150px');
		expect(site.node.style.top).toBe('20px');

		// Advance timer for transition fallback
		vi.advanceTimersByTime(300);
		expect(finish).toHaveBeenCalled();
	});
});
