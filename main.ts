import * as gmath from "gmath";
import { Globe } from "./globe.ts";
import { renderToPNG } from "./utils.ts";
import { requestDevice } from "./utils.ts";

const device = await requestDevice();
const globe = new Globe(device);
const dimensions = { width: 1000, height: 1000 };

await globe.init();

for (let rz = 0; rz <= 360; rz += 10) {
    console.log(rz);
    globe.update(new gmath.Deg(rz));
    await renderToPNG(globe, `./out/${rz}.png`, dimensions);
}
