import { runChannelPage } from './channel';
import '../styles/demos/stage-plot-rider.css';
import { initStagePlotRiderDemo } from '../ui/demos/stage-plot-rider';

runChannelPage(({ reduce }) => initStagePlotRiderDemo(document.querySelector('[data-sp-demo]'), reduce));
