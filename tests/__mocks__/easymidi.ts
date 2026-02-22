// Mock for the 'easymidi' npm package
// Provides EventEmitter-based Input/Output classes for testing

import { EventEmitter } from 'events';

const mockInputs: string[] = ['Mock Input 1', 'Mock Input 2'];
const mockOutputs: string[] = ['Mock Output 1'];

export const getInputs = jest.fn(() => [...mockInputs]);
export const getOutputs = jest.fn(() => [...mockOutputs]);

export class Input extends EventEmitter {
  name: string;
  closed = false;

  constructor(name: string) {
    super();
    this.name = name;
  }

  close() {
    this.closed = true;
    this.removeAllListeners();
  }
}

export class Output extends EventEmitter {
  name: string;
  closed = false;
  send = jest.fn();

  constructor(name: string) {
    super();
    this.name = name;
  }

  close() {
    this.closed = true;
  }
}

// Helper to mutate the mock device list for individual tests
export function __setMockInputs(inputs: string[]) {
  mockInputs.length = 0;
  mockInputs.push(...inputs);
  getInputs.mockReturnValue([...inputs]);
}

export function __setMockOutputs(outputs: string[]) {
  mockOutputs.length = 0;
  mockOutputs.push(...outputs);
  getOutputs.mockReturnValue([...outputs]);
}
