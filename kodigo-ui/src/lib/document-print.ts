export interface DocumentPrintOptions {
  frameId: string;
  frameTitle: string;
  contentSelector: string;
  frameWidth: string;
  getFrameHeight: (contentHeightPx: number) => string;
  pageSizeStyleId?: string;
  getPageRule?: (contentHeightPx: number) => string;
  missingPageStyleMessage?: string;
  preparationErrorMessage: string;
}

let printInProgress = false;
let activePrintPromise: Promise<void> | null = null;
let activeFrameId: string | null = null;

/** Shared one-at-a-time iframe transport for browser-generated documents. */
export function printDocumentHtml(html: string, options: DocumentPrintOptions): Promise<void> {
  if (printInProgress) {
    if (activeFrameId === options.frameId) return activePrintPromise ?? Promise.resolve();
    return Promise.reject(new Error('Another document is already using the browser print dialog. Wait for it to finish before printing this list.'));
  }
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return Promise.reject(new Error('Document printing is only available in a browser.'));
  }

  printInProgress = true;
  activeFrameId = options.frameId;
  let frame: HTMLIFrameElement | null = null;
  let fallbackCleanup: number | null = null;

  const cleanup = () => {
    if (fallbackCleanup !== null) window.clearTimeout(fallbackCleanup);
    frame?.remove();
    frame = null;
    printInProgress = false;
    activeFrameId = null;
    activePrintPromise = null;
  };

  const currentPromise = new Promise<void>((resolve, reject) => {
    try {
      document.getElementById(options.frameId)?.remove();
      frame = document.createElement('iframe');
      frame.id = options.frameId;
      frame.title = options.frameTitle;
      frame.style.position = 'fixed';
      frame.style.left = '-10000px';
      frame.style.top = '0';
      frame.style.width = options.frameWidth;
      frame.style.height = '1px';
      frame.style.border = '0';
      frame.style.opacity = '0';
      frame.style.pointerEvents = 'none';
      frame.setAttribute('aria-hidden', 'true');

      const printFrame = frame;
      let requested = false;
      frame.onload = () => {
        if (requested) return;
        const frameWindow = printFrame.contentWindow;
        const frameDocument = frameWindow?.document;
        const content = frameDocument?.querySelector<HTMLElement>(options.contentSelector);
        if (!frameWindow || !frameDocument || !content) {
          cleanup();
          reject(new Error(options.preparationErrorMessage));
          return;
        }

        requested = true;
        const contentHeight = Math.max(
          content.scrollHeight,
          Math.ceil(content.getBoundingClientRect().height),
        );
        printFrame.style.height = options.getFrameHeight(contentHeight);
        if (options.pageSizeStyleId && options.getPageRule) {
          const pageSizeStyle = frameDocument.getElementById(options.pageSizeStyleId);
          if (!pageSizeStyle) {
            cleanup();
            reject(new Error(options.missingPageStyleMessage || options.preparationErrorMessage));
            return;
          }
          pageSizeStyle.textContent = options.getPageRule(contentHeight);
        }

        try {
          frameWindow.focus();
          frameWindow.addEventListener('afterprint', cleanup, { once: true });
          fallbackCleanup = window.setTimeout(cleanup, 60_000);
          frameWindow.print();
          resolve();
        } catch (error) {
          cleanup();
          reject(error instanceof Error ? error : new Error('The browser rejected the print request.'));
        }
      };

      frame.srcdoc = html;
      document.body.appendChild(frame);
    } catch (error) {
      cleanup();
      reject(error instanceof Error ? error : new Error(options.preparationErrorMessage));
    }
  });

  activePrintPromise = currentPromise;
  return currentPromise;
}
