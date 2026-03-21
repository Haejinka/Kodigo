/**
 * Hardware utilities for Point-of-Sale peripherals.
 */

/**
 * Attempts to open a cash drawer connected via USB/Serial using the Web Serial API.
 * Most standard cash drawers connected to receipt printers use the ESC/POS command system.
 * This function sends the generic "kick drawer" ESC/POS command sequence.
 */
export async function openCashDrawer(): Promise<boolean> {
  // Web Serial API is only available in secure contexts and supported browsers
  if (!('serial' in navigator)) {
    console.warn('Web Serial API not supported in this browser. Cannot open cash drawer.');
    return false;
  }

  try {
    const navSerial = (navigator as any).serial;
    if (!navSerial) throw new Error('Serial not supported');

    // First, check if we already have permission to a port
    const existingPorts = await navSerial.getPorts();
    let port = existingPorts.length > 0 ? existingPorts[0] : null;

    // If not, ask the user to select one
    if (!port) {
      port = await navSerial.requestPort();
    }

    await port.open({ baudRate: 9600 }); // 9600 is standard for many serial POS devices

    const writer = port.writable.getWriter();

    // Standard ESC/POS command to kick the cash drawer (ESC p m t1 t2)
    // \x1B \x70 \x00 \x19 \xFA
    // Alternatively: 27 112 0 25 250
    const kickCommand = new Uint8Array([27, 112, 0, 25, 250]);

    await writer.write(kickCommand);
    
    // Clean up
    writer.releaseLock();
    await port.close();

    console.log('Cash drawer open command sent successfully.');
    return true;
  } catch (error) {
    console.error('Failed to open cash drawer:', error);
    return false;
  }
}
