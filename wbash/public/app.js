
const output = document.getElementById('output');
const input = document.getElementById('command');
const form = document.getElementById('terminal-form');

const status = document.getElementById('status');
const statusDot = document.getElementById('status-dot');

const history = [];
let historyIndex = 0;
let ctrlArmed = false;

const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';

const ws = new WebSocket(
    `${protocol}//${location.host}/ws`
);

function setStatus(connected, message) {
    status.textContent = message;
    statusDot.classList.toggle('connected', connected);
}

function print(text, className = 'output-line') {
    const line = document.createElement('div');

    line.className = className;

    // Avoid rendering terminal output as HTML.
    line.textContent = stripAnsi(text);

    output.appendChild(line);
    output.scrollTop = output.scrollHeight;
}

function stripAnsi(text) {
    return text
        .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
        .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, '');
}

function send(type, data = '') {
    if (ws.readyState !== WebSocket.OPEN) {
        print('WebSocket is disconnected.', 'error');
        return;
    }

    ws.send(JSON.stringify({ type, data }));
}

function clearTerminal() {
    output.innerHTML = '';
}

ws.addEventListener('open', () => {
    setStatus(true, 'Connected');
});

ws.addEventListener('message', event => {
    let packet;

    try {
        packet = JSON.parse(event.data);
    } catch {
        return;
    }

    switch (packet.type) {
        case 'ready':
            print(`Shell: ${packet.data.shell}`);
            print(`PID: ${packet.data.pid}`);
            print(`Working directory: ${packet.data.cwd}`);
            print('--------------------------------');
            break;

        case 'output':
            print(packet.data);
            break;

        case 'error':
            print(packet.data, 'error');
            break;

        case 'exit':
            print(
                `Shell exited. Code: ${packet.data.code}`,
                'error'
            );
            setStatus(false, 'Shell exited');
            break;
    }
});

ws.addEventListener('close', () => {
    setStatus(false, 'Disconnected');
    print('WebSocket connection closed.', 'error');
});

ws.addEventListener('error', () => {
    setStatus(false, 'Connection error');
});

form.addEventListener('submit', event => {
    event.preventDefault();

    const command = input.value;

    if (!command.trim()) return;

    print(`~ $ ${command}`);

    if (command.trim() === 'clear') {
        clearTerminal();
        input.value = '';
        return;
    }

    if (ws.readyState !== WebSocket.OPEN) {
        print('Shell is not connected.', 'error');
        return;
    }

    history.push(command);
    historyIndex = history.length;

    send('command', command);

    input.value = '';
});

function interrupt() {
    print('^C');
    send('interrupt');
}

function handleKey(key) {
    if (key === 'UP') {
        moveHistory(-1);
    } else if (key === 'DOWN') {
        moveHistory(1);
    } else if (key === 'TAB') {
        insertText('    ');
    } else if (key === 'ESC') {
        input.value = '';
    } else if (key === 'INT') {
        interrupt();
    } else if (key === 'LEFT') {
        moveCursor(-1);
    } else if (key === 'RIGHT') {
        moveCursor(1);
    } else if (key === 'CTRL') {
        ctrlArmed = !ctrlArmed;
    }

    input.focus();
}

function moveHistory(direction) {
    historyIndex = Math.max(
        0,
        Math.min(history.length, historyIndex + direction)
    );

    input.value = history[historyIndex] || '';
}

function insertText(text) {
    const start = input.selectionStart;
    const end = input.selectionEnd;

    input.setRangeText(text, start, end, 'end');
}

function moveCursor(direction) {
    const position = input.selectionStart + direction;

    input.setSelectionRange(position, position);
}

input.addEventListener('keydown', event => {
    if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveHistory(-1);
    }

    if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveHistory(1);
    }

    if (event.key === 'Tab') {
        event.preventDefault();
        insertText('    ');
    }

    if (event.key === 'Escape') {
        event.preventDefault();
        input.value = '';
    }

    if (event.ctrlKey && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        interrupt();
    }

    if (event.ctrlKey && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        clearTerminal();
    }

    if (ctrlArmed && event.key.length === 1) {
        event.preventDefault();

        if (event.key.toLowerCase() === 'c') {
            interrupt();
        }

        if (event.key.toLowerCase() === 'l') {
            clearTerminal();
        }

        ctrlArmed = false;
    }
});

document.querySelectorAll('footer button').forEach(button => {
    button.addEventListener('click', () => {
        handleKey(button.dataset.key);
    });
});

input.focus();

