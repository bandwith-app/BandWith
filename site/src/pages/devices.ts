import { runChannelPage } from './channel';
import '../styles/demos/devices.css';
import { initDevicesDemo } from '../ui/demos/devices';

runChannelPage(({ reduce }) => initDevicesDemo(document.querySelector('[data-devices-demo]'), reduce));
