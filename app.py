import os
from slack_bolt import App
from slack_bolt.adapter.flask import SlackRequestHandler
from flask import Flask, request

app = App(
    token=os.environ["SLACK_BOT_TOKEN"],
    signing_secret=os.environ["SLACK_SIGNING_SECRET"],
)
flask_app = Flask(__name__)
handler = SlackRequestHandler(app)


@app.message("hello")
def say_hello(message, say):
    say(f"Hey <@{message['user']}>! 👋")


@app.command("/echo")
def echo_command(ack, say, command):
    ack()
    say(command["text"])


@flask_app.route("/slack/events", methods=["POST"])
def slack_events():
    return handler.handle(request)


@flask_app.route("/", methods=["GET"])
def health():
    return "OK"


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 3000))
    flask_app.run(host="0.0.0.0", port=port)
