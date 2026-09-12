import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { ensureSiteEnv } from './_helpers';

describe('DropTargetShim', () => {
	let Drag: any;
	let DropTargetShim: any;

	beforeAll(async () => {
		await ensureSiteEnv();
		const dragDrop = await import('../../webextension/drag-drop.js');
		Drag = dragDrop.Drag;
		DropTargetShim = dragDrop.DropTargetShim;
	});

	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('handles Chrome-style DataTransfer (no mozSourceNode) by falling back to Drag.draggedSite', () => {
		const mockSite = { _link: { title: 'mock site' } } as any;
		
		const dragSpy = vi.spyOn(Drag, 'drag').mockImplementation(() => {});
		vi.spyOn(Drag, 'draggedSite', 'get').mockReturnValue(mockSite);

		const dt = {} as DataTransfer; // no mozSourceNode
		const event = {
			dataTransfer: dt,
			preventDefault: vi.fn(),
		} as unknown as DragEvent;

		vi.spyOn(DropTargetShim, '_updateDropTarget').mockImplementation(() => {});

		expect(() => {
			DropTargetShim._dragover(event);
		}).not.toThrow();

		expect(dragSpy).toHaveBeenCalledWith(mockSite, event);
	});

	it('handles Firefox-style DataTransfer (has mozSourceNode) without regression', () => {
		const mockSite = { _link: { title: 'mock site via DOM' } } as any;
		const mockNode = { parentNode: { _newtabSite: mockSite } };
		
		const dragSpy = vi.spyOn(Drag, 'drag').mockImplementation(() => {});

		const dt = {
			mozSourceNode: mockNode
		} as unknown as DataTransfer;
		
		const event = {
			dataTransfer: dt,
			preventDefault: vi.fn(),
		} as unknown as DragEvent;

		vi.spyOn(DropTargetShim, '_updateDropTarget').mockImplementation(() => {});

		expect(() => {
			DropTargetShim._dragover(event);
		}).not.toThrow();

		expect(dragSpy).toHaveBeenCalledWith(mockSite, event);
	});
});
