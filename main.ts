import { Globe } from "./globe.ts";
import { renderToPNG } from "./utils.ts";
import { requestDevice } from "./utils.ts";

const device = await requestDevice();
const globe = new Globe(device);

globe.init();

const dimensions = { width: 1000, height: 1000 };
await renderToPNG(globe, "./out.png", dimensions);
