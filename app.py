import os
from slack_bolt import App
from slack_bolt.adapter.socket_mode import SocketModeHandler

app = App(token=os.environ["SLACK_BOT_TOKEN"])


@app.message("hello")
def say_hello(message, say):
    say(f"Hey <@{message['user']}>! 👋")


@app.command("/echo")
def echo_command(ack, say, command):
    ack()
    say(command["text"])


if __name__ == "__main__":
    handler = SocketModeHandler(app, os.environ["SLACK_APP_TOKEN"])
    handler.start()
