import { runChannelPage } from './channel';
import '../styles/stage.css';
import { initStageDemo } from '../ui/stageDemo';

runChannelPage(({ reduce }) => initStageDemo(document.querySelector('[data-stage-demo]'), reduce));
